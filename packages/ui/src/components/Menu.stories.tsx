import { useRef, useState } from '@storybook/preview-api';
import type { Meta, StoryObj } from '@storybook/react';
import { Menu, MenuButton } from './Menu';

const meta: Meta<typeof Menu> = {
  title: 'Components/Menu',
  component: Menu,
  tags: ['autodocs', 'a11y'],
};

export default meta;
type Story = StoryObj<typeof Menu>;

const defaultItems = [
  { id: 'undo', label: 'Undo', onAction: () => {} },
  { id: 'redo', label: 'Redo', onAction: () => {} },
  { id: 'sep1', separator: true },
  { id: 'cut', label: 'Cut', onAction: () => {}, dialog: true },
  { id: 'copy', label: 'Copy', onAction: () => {} },
  { id: 'paste', label: 'Paste', onAction: () => {}, disabled: true },
];

const itemsWithCheckbox = [
  { id: 'bold', label: 'Bold', type: 'checkbox' as const, checked: false, onToggle: () => {} },
  { id: 'italic', label: 'Italic', type: 'checkbox' as const, checked: true, onToggle: () => {} },
  {
    id: 'underline',
    label: 'Underline',
    type: 'checkbox' as const,
    checked: false,
    onToggle: () => {},
  },
];

const itemsWithRadio = [
  {
    id: 'left',
    label: 'Align Left',
    type: 'radio' as const,
    checked: true,
    onToggle: () => {},
    group: 'align',
  },
  {
    id: 'center',
    label: 'Align Center',
    type: 'radio' as const,
    checked: false,
    onToggle: () => {},
    group: 'align',
  },
  {
    id: 'right',
    label: 'Align Right',
    type: 'radio' as const,
    checked: false,
    onToggle: () => {},
    group: 'align',
  },
];

const itemsWithSubmenu = [
  { id: 'new', label: 'New File', onAction: () => {} },
  {
    id: 'open',
    label: 'Open Recent',
    type: 'submenu' as const,
    submenu: [
      { id: 'r1', label: 'Document 1', onAction: () => {} },
      { id: 'r2', label: 'Document 2', onAction: () => {} },
    ],
  },
  { id: 'save', label: 'Save', onAction: () => {} },
];

export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
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
        />
      </>
    );
  },
};

export const WithCheckboxes: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
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
        />
      </>
    );
  },
};

export const WithRadio: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
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
        />
      </>
    );
  },
};

export const WithSubmenu: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
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
        />
      </>
    );
  },
};

export const Dark: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
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
        />
      </div>
    );
  },
  parameters: { themes: { themeOverride: 'dark' } },
};
