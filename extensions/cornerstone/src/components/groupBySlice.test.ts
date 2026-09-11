import { groupBySlice, UNGROUPED_KEY } from './groupBySlice';

describe('groupBySlice', () => {
  const displaySet = {
    displaySetInstanceUID: 'ds-1',
    instances: [
      { SOPInstanceUID: 'instance-1' },
      { SOPInstanceUID: 'instance-2' },
      { SOPInstanceUID: 'instance-3' },
    ],
  };

  const childProps = {
    servicesManager: {
      services: {
        displaySetService: {
          getDisplaySetByUID: uid => (uid === 'ds-1' ? displaySet : undefined),
        },
      },
    },
  };

  const measurementOn = (SOPInstanceUID: string, uid: string) => ({
    uid,
    SOPInstanceUID,
    displaySetInstanceUID: 'ds-1',
  });

  it('puts every annotation on a slice into that slice group', () => {
    const items = [
      measurementOn('instance-2', 'a'),
      measurementOn('instance-2', 'b'),
      measurementOn('instance-1', 'c'),
    ];

    const groups = groupBySlice(items, {}, childProps);

    expect(groups.get('slice-1').items.map(item => item.uid)).toEqual(['a', 'b']);
    expect(groups.get('slice-0').items.map(item => item.uid)).toEqual(['c']);
  });

  it('titles each group by its 1-based slice number', () => {
    const groups = groupBySlice([measurementOn('instance-3', 'a')], {}, childProps);

    expect(groups.get('slice-2').title).toBe('Slice 3');
  });

  it('orders groups by slice ascending', () => {
    const items = [
      measurementOn('instance-3', 'a'),
      measurementOn('instance-1', 'b'),
      measurementOn('instance-2', 'c'),
    ];

    const titles = [...groupBySlice(items, {}, childProps).values()].map(group => group.title);

    expect(titles).toEqual(['Slice 1', 'Slice 2', 'Slice 3']);
  });

  it('adds a new annotation to the existing group for its slice', () => {
    const existing = [measurementOn('instance-2', 'a')];
    const afterAnnotating = [...existing, measurementOn('instance-2', 'b')];

    const groups = groupBySlice(afterAnnotating, {}, childProps);

    expect(groups.size).toBe(1);
    expect(groups.get('slice-1').items).toHaveLength(2);
  });

  it('starts a separate group when the user annotates a different slice', () => {
    const items = [measurementOn('instance-1', 'a'), measurementOn('instance-3', 'b')];

    const groups = groupBySlice(items, {}, childProps);

    expect(groups.size).toBe(2);
    expect([...groups.keys()]).toEqual(['slice-0', 'slice-2']);
  });

  it('marks the group matching the active image index as selected', () => {
    const items = [measurementOn('instance-1', 'a'), measurementOn('instance-2', 'b')];

    const groups = groupBySlice(items, { activeImageIndex: 1 }, childProps);

    expect(groups.get('slice-0').isSelected).toBe(false);
    expect(groups.get('slice-1').isSelected).toBe(true);
  });

  it('collects unlocatable findings into a trailing group', () => {
    const items = [
      measurementOn('instance-2', 'a'),
      { uid: 'b', displaySetInstanceUID: 'ds-1' }, // no image reference
    ];

    const groups = groupBySlice(items, {}, childProps);

    expect(groups.get(UNGROUPED_KEY).title).toBe('Other findings');
    expect([...groups.keys()].pop()).toBe(UNGROUPED_KEY);
  });

  it('groups measurements whose display set is unknown as unlocatable', () => {
    const items = [{ uid: 'a', SOPInstanceUID: 'instance-1', displaySetInstanceUID: 'missing' }];

    const groups = groupBySlice(items, {}, childProps);

    expect(groups.get(UNGROUPED_KEY).items).toHaveLength(1);
  });

  it('returns no groups for no measurements', () => {
    expect(groupBySlice([], {}, childProps).size).toBe(0);
  });
});
