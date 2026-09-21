import withMillimetreTextLines, { toMillimetreText } from './withMillimetreTextLines';

describe('toMillimetreText', () => {
  it('rewrites the pixel units a tool prints on the image', () => {
    expect(toMillimetreText('Area: 87212 px²')).toBe('Area: 87212 mm²');
    expect(toMillimetreText('12.34 px')).toBe('12.34 mm');
  });

  it('leaves non-spatial units alone', () => {
    // Modality and angle units share the same text box and must not become millimetres.
    expect(toMillimetreText('Mean: 89.4 HU')).toBe('Mean: 89.4 HU');
    expect(toMillimetreText('35.2 degrees')).toBe('35.2 degrees');
    expect(toMillimetreText('Max: 224, 236, 233')).toBe('Max: 224, 236, 233');
  });

  it('does not rewrite a word that merely contains the unit letters', () => {
    expect(toMillimetreText('Label: pixelated area')).toBe('Label: pixelated area');
    expect(toMillimetreText('Apex region')).toBe('Apex region');
  });

  it('passes through anything that is not a string', () => {
    expect(toMillimetreText(undefined)).toBeUndefined();
    expect(toMillimetreText(42)).toBe(42);
  });
});

describe('withMillimetreTextLines', () => {
  class FakeTool {
    configuration: Record<string, unknown>;

    constructor(config = {}) {
      this.configuration = { getTextLines: () => ['Area: 100 px²'], ...config };
    }
  }

  it('rewrites every line the wrapped tool renders', () => {
    const WrappedTool = withMillimetreTextLines(FakeTool);
    const tool = new WrappedTool() as unknown as FakeTool;

    expect((tool.configuration.getTextLines as () => string[])()).toEqual(['Area: 100 mm²']);
  });

  it('keeps the tool name, so Cornerstone still resolves the tool', () => {
    class NamedTool extends FakeTool {
      static toolName = 'EllipticalROI';
    }

    const WrappedTool = withMillimetreTextLines(NamedTool);

    expect(WrappedTool.toolName).toBe('EllipticalROI');
  });

  it('preserves the tool as the `this` of the original implementation', () => {
    class StatefulTool {
      configuration: Record<string, unknown>;
      unit = 'px';

      constructor() {
        this.configuration = {
          getTextLines() {
            return [`1 ${(this as StatefulTool).unit}`];
          },
        };
      }
    }

    const WrappedTool = withMillimetreTextLines(StatefulTool);
    const tool = new WrappedTool() as unknown as StatefulTool;

    expect((tool.configuration.getTextLines as () => string[])()).toEqual(['1 mm']);
  });

  it('passes the tool arguments straight through', () => {
    const getTextLines = jest.fn(() => ['1 px']);
    const WrappedTool = withMillimetreTextLines(FakeTool);
    const tool = new WrappedTool({ getTextLines }) as unknown as FakeTool;

    (tool.configuration.getTextLines as (a: unknown, b: unknown) => string[])('data', 'target');

    expect(getTextLines).toHaveBeenCalledWith('data', 'target');
  });

  it('leaves a tool that renders no text alone', () => {
    const WrappedTool = withMillimetreTextLines(FakeTool);
    const tool = new WrappedTool({ getTextLines: undefined }) as unknown as FakeTool;

    expect(tool.configuration.getTextLines).toBeUndefined();
  });

  it('passes through a non-array return value', () => {
    const WrappedTool = withMillimetreTextLines(FakeTool);
    const tool = new WrappedTool({ getTextLines: () => undefined }) as unknown as FakeTool;

    expect((tool.configuration.getTextLines as () => unknown)()).toBeUndefined();
  });
});
