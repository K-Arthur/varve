/**
 * Frame size presets — the Figma model. Instead of choosing a document size up
 * front, users create a blank canvas and drop preset-sized frames (Phone,
 * Desktop, Social, Paper) from the inspector when the Frame tool is active or a
 * frame is selected.
 *
 * All sizes are in CSS px (the canvas' world unit). Paper sizes use the
 * conventional 96dpi px equivalents so they render at a sensible on-canvas
 * scale next to screen frames.
 */

export interface FramePreset {
  id: string;
  name: string;
  /** Short size caption, e.g. "393 × 852". */
  w: number;
  h: number;
}

export interface FramePresetGroup {
  label: string;
  presets: FramePreset[];
}

export const FRAME_PRESET_GROUPS: FramePresetGroup[] = [
  {
    label: 'Phone',
    presets: [
      { id: 'iphone-15-pro', name: 'iPhone 15 Pro', w: 393, h: 852 },
      { id: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', w: 430, h: 932 },
      { id: 'iphone-se', name: 'iPhone SE', w: 375, h: 667 },
      { id: 'android-compact', name: 'Android Compact', w: 412, h: 917 },
    ],
  },
  {
    label: 'Tablet',
    presets: [
      { id: 'ipad-air', name: 'iPad Air', w: 820, h: 1180 },
      { id: 'ipad-pro-11', name: 'iPad Pro 11"', w: 834, h: 1194 },
      { id: 'surface-pro', name: 'Surface Pro 8', w: 1440, h: 960 },
    ],
  },
  {
    label: 'Desktop',
    presets: [
      { id: 'desktop-1440', name: 'Desktop', w: 1440, h: 1024 },
      { id: 'desktop-1280', name: 'Desktop 1280', w: 1280, h: 800 },
      { id: 'wireframe-1024', name: 'Web 1024', w: 1024, h: 768 },
      { id: 'macbook-pro-16', name: 'MacBook Pro 16"', w: 1728, h: 1117 },
    ],
  },
  {
    label: 'Social',
    presets: [
      { id: 'ig-post', name: 'Instagram Post', w: 1080, h: 1080 },
      { id: 'ig-story', name: 'Instagram Story', w: 1080, h: 1920 },
      { id: 'fb-cover', name: 'Facebook Cover', w: 1640, h: 624 },
      { id: 'x-post', name: 'X Post', w: 1600, h: 900 },
    ],
  },
  {
    label: 'Presentation',
    presets: [
      { id: 'slide-16-9', name: 'Slide 16:9', w: 1920, h: 1080 },
      { id: 'slide-4-3', name: 'Slide 4:3', w: 1024, h: 768 },
    ],
  },
  {
    label: 'Paper',
    presets: [
      // 96dpi px equivalents of common paper sizes.
      { id: 'a4', name: 'A4', w: 794, h: 1123 },
      { id: 'a3', name: 'A3', w: 1123, h: 1587 },
      { id: 'us-letter', name: 'US Letter', w: 816, h: 1056 },
    ],
  },
];
