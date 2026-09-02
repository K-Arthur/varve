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
