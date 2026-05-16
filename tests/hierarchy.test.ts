import { planVaultLayout, type OutlineNode } from '../src/bisync/hierarchy';

function leaf(id: string, title: string): OutlineNode {
  return { id, title, parentId: null, collectionId: 'c1', children: [] };
}

describe('planVaultLayout', () => {
  test('plain leaves at the root', () => {
    const plans = planVaultLayout({
      rootVaultPath: 'Work',
      roots: [leaf('a', 'Alpha'), leaf('b', 'Beta')],
    });
    expect(plans).toEqual([
      {
        outlineId: 'a',
        vaultPath: 'Work/Alpha.md',
        isFolderNote: false,
        parentId: null,
        basename: 'Alpha',
      },
      {
        outlineId: 'b',
        vaultPath: 'Work/Beta.md',
        isFolderNote: false,
        parentId: null,
        basename: 'Beta',
      },
    ]);
  });

  test('doc with children becomes a folder-note', () => {
    const root: OutlineNode = {
      id: 'parent',
      title: 'Parent',
      parentId: null,
      collectionId: 'c1',
      children: [leaf('c1', 'Child 1'), leaf('c2', 'Child 2')],
    };
    const plans = planVaultLayout({
      rootVaultPath: 'W',
      roots: [root],
    });
    expect(plans.map((p) => p.vaultPath)).toEqual([
      'W/Parent/Parent.md',
      'W/Parent/Child 1.md',
      'W/Parent/Child 2.md',
    ]);
    expect(plans[0].isFolderNote).toBe(true);
  });

  test('matches the design doc Appendix A example', () => {
    // Engineering / { Architecture / {Service mesh, Auth}, Runbooks }
    const engineering: OutlineNode = {
      id: 'eng',
      title: 'Engineering',
      parentId: null,
      collectionId: 'c1',
      children: [
        {
          id: 'arch',
          title: 'Architecture',
          parentId: 'eng',
          collectionId: 'c1',
          children: [leaf('mesh', 'Service mesh'), leaf('auth', 'Auth')],
        },
        leaf('rb', 'Runbooks'),
      ],
    };
    const plans = planVaultLayout({
      rootVaultPath: 'Work/Engineering',
      roots: [engineering],
    });
    expect(plans.map((p) => p.vaultPath)).toEqual([
      'Work/Engineering/Engineering/Engineering.md',
      'Work/Engineering/Engineering/Architecture/Architecture.md',
      'Work/Engineering/Engineering/Architecture/Service mesh.md',
      'Work/Engineering/Engineering/Architecture/Auth.md',
      'Work/Engineering/Engineering/Runbooks.md',
    ]);
  });

  test('sanitizes and de-duplicates colliding sibling titles', () => {
    const a: OutlineNode = {
      id: 'a',
      title: 'A/B', // sanitizes to A-B
      parentId: null,
      collectionId: 'c1',
      children: [],
    };
    const b: OutlineNode = { ...a, id: 'b', title: 'A:B' }; // also A-B
    const plans = planVaultLayout({ rootVaultPath: 'W', roots: [a, b] });
    expect(plans[0].vaultPath).toBe('W/A-B.md');
    expect(plans[1].vaultPath).toBe('W/A-B (1).md');
  });
});
