import type { Meta, StoryObj } from '@storybook/react';
import { useRef, useState } from 'storybook/preview-api';
import { Menu, MenuButton, type MenuEntry } from './Menu';

const meta: Meta<typeof Menu> = {
  title: 'Components/Menu',
  component: Menu,
  tags: ['autodocs', 'a11y'],
};

export default meta;
type Story = StoryObj<typeof Menu>;

const defaultItems: readonly MenuEntry[] = [
  { id: 'undo', label: 'Undo', icon: 'Undo2', shortcut: 'Ctrl+Z', onAction: () => {} },
  { id: 'redo', label: 'Redo', icon: 'Redo2', shortcut: 'Ctrl+Shift+Z', onAction: () => {} },
  { id: 'sep1', separator: true },
  {
    id: 'cut',
    label: 'Cut',
    icon: 'Scissors',
    shortcut: 'Ctrl+X',
    onAction: () => {},
    dialog: true,
  },
  { id: 'copy', label: 'Copy', icon: 'Copy', shortcut: 'Ctrl+C', onAction: () => {} },
  {
    id: 'paste',
    label: 'Paste',
    icon: 'Clipboard',
    shortcut: 'Ctrl+V',
    onAction: () => {},
    disabled: true,
  },
];

const itemsWithCheckbox: readonly MenuEntry[] = [
  { id: 'bold', label: 'Bold', type: 'checkbox', checked: false, onToggle: () => {} },
  { id: 'italic', label: 'Italic', type: 'checkbox', checked: true, onToggle: () => {} },
  { id: 'underline', label: 'Underline', type: 'checkbox', checked: false, onToggle: () => {} },
];

const itemsWithRadio: readonly MenuEntry[] = [
  {
    id: 'left',
    label: 'Align Left',
    type: 'radio',
    checked: true,
    onToggle: () => {},
    group: 'align',
  },
  {
    id: 'center',
    label: 'Align Center',
    type: 'radio',
    checked: false,
    onToggle: () => {},
    group: 'align',
  },
  {
    id: 'right',
    label: 'Align Right',
    type: 'radio',
    checked: false,
    onToggle: () => {},
    group: 'align',
  },
];

const itemsWithSubmenu: readonly MenuEntry[] = [
  { id: 'new', label: 'New File', onAction: () => {} },
  {
    id: 'open',
    label: 'Open Recent',
    type: 'submenu',
    submenu: [
      { id: 'r1', label: 'Document 1', onAction: () => {} },
      { id: 'r2', label: 'Document 2', onAction: () => {} },
    ],
  },
  { id: 'save', label: 'Save', onAction: () => {} },
];

const itemsWithRichContent: readonly MenuEntry[] = [
  { id: 'label', type: 'label', label: 'Export format' },
  {
    id: 'png',
    label: 'PNG image',
    description: 'Best for transparent UI assets',
    icon: 'Image',
    shortcut: 'Ctrl+Alt+P',
    onAction: () => {},
  },
  {
    id: 'svg',
    label: 'SVG vector',
    description: 'Keeps paths editable at any size',
    icon: 'Shapes',
    onAction: () => {},
  },
  { id: 'sep', separator: true },
  {
    id: 'remove',
    label: 'Remove export preset',
    icon: 'Trash2',
    destructive: true,
    onAction: () => {},
  },
];

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return (
      <>
        <MenuButton
          ref={triggerRef}
          label="File"
          menuId="file-menu"
          expanded={open}
          onClick={() => setOpen(!open)}
        />
        <Menu
          items={defaultItems}
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          label="File menu"
          id="file-menu"
        />
      </>
    );
  },
};

export const WithCheckboxes: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return (
      <>
        <MenuButton
          ref={triggerRef}
          label="Format"
          menuId="format-menu"
          expanded={open}
          onClick={() => setOpen(!open)}
        />
        <Menu
          items={itemsWithCheckbox}
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          label="Format menu"
          id="format-menu"
        />
      </>
    );
  },
};

export const WithRadio: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return (
      <>
        <MenuButton
          ref={triggerRef}
          label="Align"
          menuId="align-menu"
          expanded={open}
          onClick={() => setOpen(!open)}
        />
        <Menu
          items={itemsWithRadio}
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          label="Align menu"
          id="align-menu"
        />
      </>
    );
  },
};

export const WithSubmenu: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return (
      <>
        <MenuButton
          ref={triggerRef}
          label="File"
          menuId="file-menu"
          expanded={open}
          onClick={() => setOpen(!open)}
        />
        <Menu
          items={itemsWithSubmenu}
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          label="File menu"
          id="submenu-menu"
        />
      </>
    );
  },
};

export const Dark: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return (
      <div data-theme="dark" style={{ background: '#10151f', padding: '24px', minHeight: '200px' }}>
        <MenuButton
          ref={triggerRef}
          label="File"
          menuId="file-menu-dark"
          expanded={open}
          onClick={() => setOpen(!open)}
        />
        <Menu
          items={defaultItems}
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          label="File menu"
          id="file-menu-dark"
        />
      </div>
    );
  },
  parameters: { themes: { themeOverride: 'dark' } },
};

export const Rich: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return (
      <>
        <MenuButton
          ref={triggerRef}
          label="Export"
          menuId="export-menu"
          expanded={open}
          onClick={() => setOpen(!open)}
        />
        <Menu
          items={itemsWithRichContent}
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          label="Export menu"
          id="export-menu"
          size="rich"
        />
      </>
    );
  },
};

export const Overflow: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const items = Array.from(
      { length: 36 },
      (_, index): MenuEntry => ({
        id: `overflow-${index}`,
        label: `Long menu option ${index + 1}`,
        shortcut: index < 10 ? `Ctrl+${index + 1}` : undefined,
        onAction: () => {},
      }),
    );
    return (
      <>
        <MenuButton
          ref={triggerRef}
          label="Overflow"
          menuId="overflow-menu"
          expanded={open}
          onClick={() => setOpen(!open)}
        />
        <Menu
          items={items}
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          label="Overflow menu"
          id="overflow-menu"
          maxVisibleItems={12}
        />
      </>
    );
  },
};

const groupedItems: readonly MenuEntry[] = [
  { id: 'clip-label', type: 'label', label: 'Clipboard' },
  { id: 'cut', label: 'Cut', icon: 'Scissors', shortcut: 'Ctrl+X', onAction: () => {} },
  { id: 'copy', label: 'Copy', icon: 'Copy', shortcut: 'Ctrl+C', onAction: () => {} },
  { id: 'paste', label: 'Paste', icon: 'ClipboardPaste', shortcut: 'Ctrl+V', onAction: () => {} },
  { id: 'sep1', separator: true },
  { id: 'arrange-label', type: 'label', label: 'Arrange' },
  { id: 'duplicate', label: 'Duplicate', icon: 'CopyPlus', onAction: () => {} },
  {
    id: 'delete',
    label: 'Delete',
    icon: 'Trash2',
    destructive: true,
    onAction: () => {},
  },
  { id: 'sep2', separator: true },
  { id: 'danger-label', type: 'label', label: 'Danger Zone', danger: true },
  {
    id: 'remove-mask',
    label: 'Remove Mask',
    icon: 'Trash2',
    destructive: true,
    onAction: () => {},
  },
];

export const GroupedWithDanger: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return (
      <>
        <MenuButton
          ref={triggerRef}
          label="Context"
          menuId="grouped-menu"
          expanded={open}
          onClick={() => setOpen(!open)}
        />
        <Menu
          items={groupedItems}
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          label="Grouped context menu"
          id="grouped-menu"
        />
      </>
    );
  },
};

const allDisabledItems: readonly MenuEntry[] = [
  { id: 'cut', label: 'Cut', icon: 'Scissors', disabled: true, onAction: () => {} },
  { id: 'copy', label: 'Copy', icon: 'Copy', disabled: true, onAction: () => {} },
  { id: 'paste', label: 'Paste', icon: 'ClipboardPaste', disabled: true, onAction: () => {} },
  { id: 'delete', label: 'Delete', icon: 'Trash2', disabled: true, onAction: () => {} },
];

export const AllDisabled: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return (
      <>
        <MenuButton
          ref={triggerRef}
          label="Disabled"
          menuId="disabled-menu"
          expanded={open}
          onClick={() => setOpen(!open)}
        />
        <Menu
          items={allDisabledItems}
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          label="All disabled menu"
          id="disabled-menu"
        />
      </>
    );
  },
};

const emptyItems: readonly MenuEntry[] = [];

export const Empty: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return (
      <>
        <MenuButton
          ref={triggerRef}
          label="Empty"
          menuId="empty-menu"
          expanded={open}
          onClick={() => setOpen(!open)}
        />
        <Menu
          items={emptyItems}
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          label="Empty menu"
          id="empty-menu"
        />
      </>
    );
  },
};

const longLabelsItems: readonly MenuEntry[] = [
  {
    id: 'long1',
    label: 'Use Selection as File Thumbnail',
    icon: 'Image',
    onAction: () => {},
  },
  {
    id: 'long2',
    label: 'Detect Duplicates in Selection',
    icon: 'ScanSearch',
    onAction: () => {},
  },
  {
    id: 'long3',
    label: 'Move to Trash',
    icon: 'Trash2',
    destructive: true,
    onAction: () => {},
  },
];

export const LongLabels: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return (
      <>
        <MenuButton
          ref={triggerRef}
          label="Long Labels"
          menuId="long-menu"
          expanded={open}
          onClick={() => setOpen(!open)}
        />
        <Menu
          items={longLabelsItems}
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          label="Long labels menu"
          id="long-menu"
          size="default"
        />
      </>
    );
  },
};

const homeFileItems: readonly MenuEntry[] = [
  { id: 'file-label', type: 'label', label: 'File' },
  { id: 'open', label: 'Open', icon: 'ExternalLink', onAction: () => {} },
  { id: 'sep1', separator: true },
  { id: 'rename', label: 'Rename', icon: 'Pencil', onAction: () => {} },
  { id: 'duplicate', label: 'Duplicate', icon: 'CopyPlus', onAction: () => {} },
  { id: 'org-label', type: 'label', label: 'Organization' },
  { id: 'project1', label: 'My Project', icon: 'Folder', onAction: () => {} },
  { id: 'unfiled', label: 'Unfiled', icon: 'FolderOpen', onAction: () => {} },
  { id: 'sep2', separator: true },
  { id: 'favorite', label: 'Add to Favorites', icon: 'Star', onAction: () => {} },
  { id: 'pin', label: 'Pin', icon: 'Pin', onAction: () => {} },
  { id: 'sep3', separator: true },
  { id: 'versions', label: 'Version History…', icon: 'Clock', onAction: () => {} },
  { id: 'reveal', label: 'Show in Folder', icon: 'FolderOpen', onAction: () => {} },
  { id: 'danger-sep', separator: true },
  { id: 'danger-label', type: 'label', label: 'Danger Zone', danger: true },
  {
    id: 'trash',
    label: 'Move to Trash',
    icon: 'Trash2',
    destructive: true,
    onAction: () => {},
  },
];

export const HomeFileContextMenu: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return (
      <>
        <MenuButton
          ref={triggerRef}
          label="File Card"
          menuId="home-file-menu"
          expanded={open}
          onClick={() => setOpen(!open)}
        />
        <Menu
          items={homeFileItems}
          triggerRef={triggerRef}
          open={open}
          onClose={() => setOpen(false)}
          label="File actions for design-v3.varve"
          id="home-file-menu"
          size="default"
        />
      </>
    );
  },
};
