import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
  autoUpdate: vi.fn(() => vi.fn()),
  flip: vi.fn(),
  shift: vi.fn(),
  offset: vi.fn(),
  size: vi.fn(),
}));

import { useEditor } from '../../context';
import { MasterPanel } from './MasterPanel';

function mockEditor(overrides: {
  masters?: Record<
    string,
    {
      id: string;
      name: string;
      width: number;
      height: number;
      contentRoot: string;
      appliesTo: string;
    }
  >;
  pages?: Array<{
    id: string;
    name: string;
    width: number;
    height: number;
    contentRoot: string;
    masterPageId?: string;
    masterOverrides?: Record<string, unknown>;
  }>;
  activePageId?: string | null;
  createMaster?: ReturnType<typeof vi.fn>;
  deleteMaster?: ReturnType<typeof vi.fn>;
  renameMaster?: ReturnType<typeof vi.fn>;
  duplicateMaster?: ReturnType<typeof vi.fn>;
  assignMasterToPage?: ReturnType<typeof vi.fn>;
  setMasterAppliesTo?: ReturnType<typeof vi.fn>;
  getPageNumber?: ReturnType<typeof vi.fn>;
}) {
  const masters = overrides.masters ?? {};
  const pages = overrides.pages ?? [];
  const activePageId = overrides.activePageId ?? pages[0]?.id ?? null;

  vi.mocked(useEditor).mockReturnValue({
    state: {
      document: {
        masters,
        pages,
        activePageId,
      },
    },
    createMaster: overrides.createMaster ?? vi.fn(),
    deleteMaster: overrides.deleteMaster ?? vi.fn(),
    renameMaster: overrides.renameMaster ?? vi.fn(),
    duplicateMaster: overrides.duplicateMaster ?? vi.fn(),
    assignMasterToPage: overrides.assignMasterToPage ?? vi.fn(),
    setMasterAppliesTo: overrides.setMasterAppliesTo ?? vi.fn(),
    getPageNumber: overrides.getPageNumber ?? vi.fn(() => 1),
  } as unknown as ReturnType<typeof useEditor>);
}

describe('MasterPanel', () => {
  it('renders empty state when no masters exist', () => {
    mockEditor({ masters: {} });
    render(<MasterPanel />);
    expect(screen.getByText('No master pages yet.')).toBeDefined();
    // The fuller explanation is a tooltip on the create button rather than a
    // block of copy, so the panel stays short enough not to squeeze the layers
    // tree that shares its sidebar column.
    expect(
      screen.getByRole('button', { name: 'Create new master page' }).getAttribute('title'),
    ).toMatch(/reusable layouts/);
  });

  it('renders list of masters', () => {
    mockEditor({
      masters: {
        m1: {
          id: 'm1',
          name: 'Left Master',
          width: 1920,
          height: 1080,
          contentRoot: 'cr1',
          appliesTo: 'all',
        },
        m2: {
          id: 'm2',
          name: 'Right Master',
          width: 1920,
          height: 1080,
          contentRoot: 'cr2',
          appliesTo: 'right',
        },
      },
    });
    render(<MasterPanel />);
    expect(screen.getByText('Left Master')).toBeDefined();
    expect(screen.getByText('Right Master')).toBeDefined();
  });

  it('calls createMaster when add button is clicked', () => {
    const createMaster = vi.fn();
    mockEditor({ createMaster });
    render(<MasterPanel />);
    fireEvent.click(screen.getByLabelText('Create new master page'));
    expect(createMaster).toHaveBeenCalledWith('Master', 1920, 1080);
  });

  it('shows appliesTo select for each master', () => {
    mockEditor({
      masters: {
        m1: {
          id: 'm1',
          name: 'Master 1',
          width: 1920,
          height: 1080,
          contentRoot: 'cr1',
          appliesTo: 'all',
        },
      },
    });
    render(<MasterPanel />);
    const select = screen.getByLabelText(/Apply to pages/);
    expect(select).toBeDefined();
    expect(select).toHaveTextContent('All pages');
  });

  it('calls setMasterAppliesTo when select changes', () => {
    const setMasterAppliesTo = vi.fn();
    mockEditor({
      masters: {
        m1: {
          id: 'm1',
          name: 'Master 1',
          width: 1920,
          height: 1080,
          contentRoot: 'cr1',
          appliesTo: 'all',
        },
      },
      setMasterAppliesTo,
    });
    render(<MasterPanel />);
    fireEvent.click(screen.getByLabelText(/Apply to pages:/));
    fireEvent.click(screen.getByRole('option', { name: /left pages/i }));
    expect(setMasterAppliesTo).toHaveBeenCalledWith('m1', 'left');
  });

  it('calls duplicateMaster when copy button is clicked', () => {
    const duplicateMaster = vi.fn();
    mockEditor({
      masters: {
        m1: {
          id: 'm1',
          name: 'Master 1',
          width: 1920,
          height: 1080,
          contentRoot: 'cr1',
          appliesTo: 'all',
        },
      },
      duplicateMaster,
    });
    render(<MasterPanel />);
    fireEvent.click(screen.getByLabelText('Duplicate Master 1'));
    expect(duplicateMaster).toHaveBeenCalledWith('m1');
  });

  it('shows page status with assigned master', () => {
    mockEditor({
      masters: {
        m1: {
          id: 'm1',
          name: 'Grid Master',
          width: 1920,
          height: 1080,
          contentRoot: 'cr1',
          appliesTo: 'all',
        },
      },
      pages: [
        {
          id: 'p1',
          name: 'Page 1',
          width: 1920,
          height: 1080,
          contentRoot: 'cr1',
          masterPageId: 'm1',
        },
      ],
      activePageId: 'p1',
    });
    render(<MasterPanel />);
    expect(screen.getByText(/Master:/)).toBeDefined();
    expect(screen.getByText('Grid Master')).toBeDefined();
  });

  it('shows no-master status when page has no master', () => {
    mockEditor({
      masters: {},
      pages: [{ id: 'p1', name: 'Page 1', width: 1920, height: 1080, contentRoot: 'cr1' }],
      activePageId: 'p1',
    });
    render(<MasterPanel />);
    expect(screen.getByText('No master')).toBeDefined();
  });

  it('shows override count when overrides exist', () => {
    mockEditor({
      masters: {
        m1: {
          id: 'm1',
          name: 'Master',
          width: 1920,
          height: 1080,
          contentRoot: 'cr1',
          appliesTo: 'all',
        },
      },
      pages: [
        {
          id: 'p1',
          name: 'Page 1',
          width: 1920,
          height: 1080,
          contentRoot: 'cr1',
          masterPageId: 'm1',
          masterOverrides: { n1: { type: 'hidden' }, n2: { type: 'modified' } },
        },
      ],
      activePageId: 'p1',
    });
    render(<MasterPanel />);
    expect(screen.getByText(/2 overrides/)).toBeDefined();
  });

  it('calls assignMasterToPage(null) when detach is clicked', () => {
    const assignMasterToPage = vi.fn();
    mockEditor({
      masters: {
        m1: {
          id: 'm1',
          name: 'Master',
          width: 1920,
          height: 1080,
          contentRoot: 'cr1',
          appliesTo: 'all',
        },
      },
      pages: [
        {
          id: 'p1',
          name: 'Page 1',
          width: 1920,
          height: 1080,
          contentRoot: 'cr1',
          masterPageId: 'm1',
        },
      ],
      activePageId: 'p1',
      assignMasterToPage,
    });
    render(<MasterPanel />);
    fireEvent.click(screen.getByLabelText('Remove master from this page'));
    expect(assignMasterToPage).toHaveBeenCalledWith('p1', null);
  });

  it('enter key on rename input commits the rename', () => {
    const renameMaster = vi.fn();
    mockEditor({
      masters: {
        m1: {
          id: 'm1',
          name: 'Old Name',
          width: 1920,
          height: 1080,
          contentRoot: 'cr1',
          appliesTo: 'all',
        },
      },
      renameMaster,
    });
    render(<MasterPanel />);
    fireEvent.doubleClick(screen.getByText('Old Name'));
    const input = screen.getByLabelText('Master name');
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameMaster).toHaveBeenCalledWith('m1', 'New Name');
  });

  it('escape key on rename input cancels without calling renameMaster', () => {
    const renameMaster = vi.fn();
    mockEditor({
      masters: {
        m1: {
          id: 'm1',
          name: 'Original',
          width: 1920,
          height: 1080,
          contentRoot: 'cr1',
          appliesTo: 'all',
        },
      },
      renameMaster,
    });
    render(<MasterPanel />);
    fireEvent.doubleClick(screen.getByText('Original'));
    const input = screen.getByLabelText('Master name');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(renameMaster).not.toHaveBeenCalled();
    expect(screen.getByText('Original')).toBeDefined();
  });

  it('all buttons have accessible labels', () => {
    mockEditor({
      masters: {
        m1: {
          id: 'm1',
          name: 'Test Master',
          width: 1920,
          height: 1080,
          contentRoot: 'cr1',
          appliesTo: 'all',
        },
      },
    });
    render(<MasterPanel />);
    expect(screen.getByLabelText('Create new master page')).toBeDefined();
    expect(screen.getByLabelText('Duplicate Test Master')).toBeDefined();
    expect(screen.getByLabelText('Delete Test Master')).toBeDefined();
  });
});
