#!/usr/bin/env python3
"""
Local EyeGestures sidecar for the OHIF gaze heatmap MVP.

Install runtime deps in your Python environment:
  python3 -m pip install eyeGestures websockets opencv-python

Run:
  python3 .scripts/eyegestures_sidecar.py --port 8765

Smoke-test the OHIF/browser wiring without a webcam:
  python3 .scripts/eyegestures_sidecar.py --mock --port 8765

The browser client connects to ws://localhost:8765/gaze and receives local-only
screen gaze samples. No DICOM data is sent to this process.
"""

import argparse
import asyncio
import json
import signal
import sys
import threading
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Set


@dataclass
class GazeSample:
    x: float
    y: float
    timestamp: int
    status: Optional[str] = None
    message: Optional[str] = None
    confidence: Optional[float] = None
    fixation: Optional[bool] = None
    saccades: Optional[bool] = None
    calibration_x: Optional[float] = None
    calibration_y: Optional[float] = None

    def to_json(self) -> str:
        payload = {
            "type": "gaze",
            "x": self.x,
            "y": self.y,
            "timestamp": self.timestamp,
        }

        if self.confidence is not None:
            payload["confidence"] = self.confidence
        if self.fixation is not None:
            payload["fixation"] = self.fixation
        if self.saccades is not None:
            payload["saccades"] = self.saccades
        if self.status is not None:
            payload["status"] = self.status
        if self.message is not None:
            payload["message"] = self.message
        if self.calibration_x is not None and self.calibration_y is not None:
            payload["calibration"] = {
                "x": self.calibration_x,
                "y": self.calibration_y,
            }

        return json.dumps(payload)


class EyeGesturesRunner:
    def __init__(
        self,
        camera: int,
        width: int,
        height: int,
        queue: asyncio.Queue,
        loop,
        debug: bool = False,
        save_frame: Optional[str] = None,
        legacy_face_color_patch: bool = False,
        eyegestures_path: Optional[str] = None,
    ):
        self.camera = camera
        self.width = width
        self.height = height
        self.queue = queue
        self.loop = loop
        self.debug = debug
        self.save_frame = save_frame
        self.legacy_face_color_patch = legacy_face_color_patch
        self.eyegestures_path = eyegestures_path
        self.saved_frame = False
        self.stop_event = threading.Event()

    def stop(self):
        self.stop_event.set()

    def put_status(self, status: str, message: str):
        payload = json.dumps({"type": "status", "status": status, "message": message})
        asyncio.run_coroutine_threadsafe(self.queue.put(payload), self.loop)

    def put_sample(self, sample: GazeSample):
        asyncio.run_coroutine_threadsafe(self.queue.put(sample.to_json()), self.loop)

    def patch_face_finder(self):
        if not self.legacy_face_color_patch:
            return

        try:
            import eyeGestures.face as face_module
        except Exception:
            return

        if getattr(face_module.FaceFinder.find, "_ohif_rgb_patch", False):
            return

        original_find = face_module.FaceFinder.find

        def find_rgb(self, image):
            assert len(image.shape) > 2
            if not hasattr(self, "mp_face_mesh"):
                return original_find(self, image)

            try:
                return self.mp_face_mesh.process(image)
            except Exception as error:
                print(f"Exception in patched FaceFinder: {error}", flush=True)
                return None

        find_rgb._ohif_rgb_patch = True
        face_module.FaceFinder.find = find_rgb

    def get_engine(self):
        try:
            import eyeGestures
            from eyeGestures import EyeGestures_v4

            if getattr(eyeGestures, "RustEyeGesturesEngine", None) is None:
                raise ImportError("EyeGestures_v4 Rust engine is not available for this Python.")

            return EyeGestures_v4(), "EyeGestures_v4", "v4"
        except Exception:
            pass

        try:
            from eyeGestures import EyeGestures_v3

            return EyeGestures_v3(), "EyeGestures_v3", "legacy"
        except Exception:
            pass

        from eyeGestures import EyeGestures_v2

        return EyeGestures_v2(), "EyeGestures_v2", "legacy"

    def add_local_project_path(self):
        if not self.eyegestures_path:
            return

        if self.eyegestures_path not in sys.path:
            sys.path.insert(0, self.eyegestures_path)

    def setup_legacy_calibration(self, gestures):
        try:
            import numpy as np

            x = np.arange(0, 1.1, 0.2)
            y = np.arange(0, 1.1, 0.2)
            xx, yy = np.meshgrid(x, y)
            calibration_map = np.column_stack([xx.ravel(), yy.ravel()])
            np.random.shuffle(calibration_map)
            gestures.uploadCalibrationMap(calibration_map, context="ohif")
            gestures.setFixation(1.0)
            return min(len(calibration_map), 25)
        except Exception as error:
            if self.debug:
                print(f"Legacy calibration setup skipped: {error!r}", flush=True)
            return 25

    def step_v4(self, gestures, frame):
        point, calibrating, calibration_point = gestures.step(frame, self.width, self.height)
        return {
            "point": point,
            "calibrating": calibrating,
            "calibration_point": calibration_point,
            "confidence": None,
            "fixation": None,
            "saccades": None,
        }

    def step_legacy(self, gestures, frame, calibrate):
        try:
            event, calibration = gestures.step(
                frame,
                calibrate,
                self.width,
                self.height,
                context="ohif",
            )
        except TypeError as error:
            if "unexpected keyword argument 'context'" not in str(error):
                raise

            event, calibration = gestures.step(
                frame,
                calibrate,
                self.width,
                self.height,
            )

        if not event:
            return None

        return {
            "point": getattr(event, "point", None),
            "calibrating": calibrate,
            "calibration_point": getattr(calibration, "point", None),
            "confidence": getattr(event, "confidence", None),
            "fixation": getattr(event, "fixation", None),
            "saccades": getattr(event, "saccades", getattr(event, "saccadess", None)),
        }

    def run(self):
        self.add_local_project_path()

        try:
            from eyeGestures.utils import VideoCapture
        except Exception as error:
            self.put_status(
                "disconnected",
                f"EyeGestures import failed. Install eyeGestures and dependencies. {error}",
            )
            return

        self.patch_face_finder()

        try:
            gestures, engine_name, engine_api = self.get_engine()
        except Exception as error:
            self.put_status("disconnected", f"EyeGestures engine import failed: {error}")
            return

        cap = VideoCapture(self.camera)
        legacy_calibration_total = self.setup_legacy_calibration(gestures) if engine_api == "legacy" else 0
        legacy_calibration_index = 0
        previous_calibration_point = None
        frames_seen = 0
        events_seen = 0
        last_status_at = 0

        self.put_status("calibrating", f"{engine_name} started; follow the calibration point.")

        while not self.stop_event.is_set():
            ret, frame = cap.read()

            if not ret:
                now = time.time()
                if now - last_status_at > 2:
                    self.put_status("waiting", "Waiting for camera frames.")
                    last_status_at = now
                time.sleep(0.05)
                continue

            frames_seen += 1
            if self.save_frame and not self.saved_frame:
                try:
                    import cv2

                    path = Path(self.save_frame)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    cv2.imwrite(str(path), frame)
                    self.saved_frame = True
                    print(f"Saved camera frame to {path}", flush=True)
                except Exception as error:
                    print(f"Failed to save camera frame: {error!r}", flush=True)

            try:
                if engine_api == "v4":
                    result = self.step_v4(gestures, frame)
                else:
                    calibrate = legacy_calibration_index <= legacy_calibration_total
                    result = self.step_legacy(gestures, frame, calibrate)
            except Exception as error:
                now = time.time()
                if now - last_status_at > 2:
                    self.put_status(
                        "waiting",
                        f"{engine_name} waiting for face landmarks; frames={frames_seen}, gaze_points={events_seen}.",
                    )
                    last_status_at = now
                if self.debug:
                    print(f"EyeGestures step skipped: {error!r}", flush=True)
                time.sleep(0.25)
                continue

            if not result:
                now = time.time()
                if now - last_status_at > 2:
                    self.put_status(
                        "waiting",
                        f"{engine_name} running; frames={frames_seen}, gaze_points={events_seen}.",
                    )
                    last_status_at = now
                continue

            point = result["point"]
            if not point or len(point) < 2:
                if self.debug:
                    print(f"EyeGestures event without point: {result!r}", flush=True)
                continue

            calibration_point = result.get("calibration_point")
            calibrating = bool(result.get("calibrating"))

            if engine_api == "legacy" and calibrating and calibration_point:
                current_calibration_point = (float(calibration_point[0]), float(calibration_point[1]))
                if current_calibration_point != previous_calibration_point:
                    legacy_calibration_index += 1
                    previous_calibration_point = current_calibration_point
                    self.put_status(
                        "calibrating",
                        f"{engine_name} calibration {legacy_calibration_index}/{legacy_calibration_total}.",
                    )

            events_seen += 1
            if self.debug and events_seen % 30 == 1:
                print(f"gaze point: {point[0]}, {point[1]}", flush=True)

            status = "calibrating" if calibrating else "connected"
            message = (
                f"{engine_name} calibrating; follow the dot."
                if calibrating
                else f"{engine_name} tracking active."
            )

            self.put_sample(
                GazeSample(
                    x=float(point[0]),
                    y=float(point[1]),
                    timestamp=int(time.time() * 1000),
                    status=status,
                    message=message,
                    confidence=result.get("confidence"),
                    fixation=result.get("fixation"),
                    saccades=result.get("saccades"),
                    calibration_x=float(calibration_point[0]) if calibration_point else None,
                    calibration_y=float(calibration_point[1]) if calibration_point else None,
                )
            )

        try:
            cap.release()
        except Exception:
            pass


class MockGazeRunner:
    def __init__(self, width: int, height: int, queue: asyncio.Queue, loop):
        self.width = width
        self.height = height
        self.queue = queue
        self.loop = loop
        self.stop_event = threading.Event()

    def stop(self):
        self.stop_event.set()

    def put_status(self, status: str, message: str):
        payload = json.dumps({"type": "status", "status": status, "message": message})
        asyncio.run_coroutine_threadsafe(self.queue.put(payload), self.loop)

    def put_sample(self, sample: GazeSample):
        asyncio.run_coroutine_threadsafe(self.queue.put(sample.to_json()), self.loop)

    def run(self):
        self.put_status("connected", "Mock gaze stream active.")
        started = time.time()

        while not self.stop_event.is_set():
            elapsed = time.time() - started
            x = self.width * (0.5 + 0.28 * math.sin(elapsed * 0.8))
            y = self.height * (0.5 + 0.22 * math.cos(elapsed * 1.1))
            self.put_sample(
                GazeSample(
                    x=x,
                    y=y,
                    timestamp=int(time.time() * 1000),
                    confidence=0.95,
                    fixation=True,
                    saccades=False,
                )
            )
            time.sleep(0.08)


async def handler(websocket, _path, clients: Set):
    clients.add(websocket)
    await websocket.send(
        json.dumps({"type": "status", "status": "waiting", "message": "Connected to sidecar."})
    )

    try:
        await websocket.wait_closed()
    finally:
        clients.discard(websocket)


async def broadcaster(queue: asyncio.Queue, clients: Set):
    while True:
        message = await queue.get()
        stale = []

        for client in clients:
            try:
                await client.send(message)
            except Exception:
                stale.append(client)

        for client in stale:
            clients.discard(client)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--mock", action="store_true")
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--save-frame")
    parser.add_argument(
        "--legacy-face-color-patch",
        action="store_true",
        help="Enable the old mp_face_mesh RGB patch for legacy EyeGestures builds only.",
    )
    parser.add_argument(
        "--eyegestures-path",
        default=None,
        help="Optional local EyeGestures repo path to place first on PYTHONPATH.",
    )
    args = parser.parse_args()

    try:
        import websockets
    except Exception as error:
        raise SystemExit(
            "Missing dependency: websockets. Install with `python3 -m pip install websockets`."
        ) from error

    queue: asyncio.Queue = asyncio.Queue()
    clients: Set = set()
    loop = asyncio.get_running_loop()
    runner = (
        MockGazeRunner(args.width, args.height, queue, loop)
        if args.mock
        else EyeGesturesRunner(
            args.camera,
            args.width,
            args.height,
            queue,
            loop,
            args.debug,
            args.save_frame,
            args.legacy_face_color_patch,
            args.eyegestures_path,
        )
    )
    thread = threading.Thread(target=runner.run, daemon=True)

    stop = asyncio.Event()

    def request_stop(*_args):
        runner.stop()
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, request_stop)
        except NotImplementedError:
            signal.signal(sig, request_stop)

    thread.start()
    broadcast_task = asyncio.create_task(broadcaster(queue, clients))

    async with websockets.serve(
        lambda websocket, *handler_args: handler(websocket, None, clients),
        args.host,
        args.port,
    ):
        print(f"EyeGestures sidecar listening at ws://{args.host}:{args.port}/gaze")
        await stop.wait()

    broadcast_task.cancel()


if __name__ == "__main__":
    asyncio.run(main())
