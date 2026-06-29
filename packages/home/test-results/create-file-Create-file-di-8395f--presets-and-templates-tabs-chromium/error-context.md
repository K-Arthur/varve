# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: create-file.spec.ts >> Create file >> dialog contains presets and templates tabs
- Location: packages/home/e2e/create-file.spec.ts:18:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Blank')
Expected: visible
Error: strict mode violation: getByText('Blank') resolved to 2 elements:
    1) <span>Blank</span> aka getByRole('radio', { name: 'Blank' })
    2) <div>Blank</div> aka getByRole('button', { name: 'Blank 1920 × 1080 px' })

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Blank')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - navigation "File navigation" [ref=e5]:
    - option "Recent5" [selected] [ref=e6]:
      - img [ref=e7]
      - text: Recent5
    - option "All Files20" [ref=e10]:
      - img [ref=e11]
      - text: All Files20
    - option "Brand8 Pin Brand" [ref=e14]:
      - img [ref=e15]
      - text: Brand8
      - button "Pin Brand" [ref=e17]:
        - img [ref=e18]
    - option "Marketing6 Pin Marketing" [ref=e22]:
      - img [ref=e23]
      - text: Marketing6
      - button "Pin Marketing" [ref=e25]:
        - img [ref=e26]
    - option "App UI0 Pin App UI" [ref=e30]:
      - img [ref=e31]
      - text: App UI0
      - button "Pin App UI" [ref=e33]:
        - img [ref=e34]
    - option "Templates0" [ref=e38]:
      - img [ref=e39]
      - text: Templates0
    - option "Trash0" [ref=e44]:
      - img [ref=e45]
      - text: Trash0
  - generic [ref=e48]:
    - generic [ref=e49]:
      - button "Hide sidebar" [ref=e50]:
        - img [ref=e51]
      - button "New File" [ref=e52]:
        - img [ref=e53]
        - text: New File
      - button "Open..." [ref=e54]
    - generic [ref=e56]:
      - img [ref=e57]
      - combobox "Search files..." [ref=e60]
      - status [ref=e61]: 5 results
    - generic [ref=e62]:
      - generic [ref=e63]:
        - radiogroup "Sort by" [ref=e64]:
          - radio "Opened" [checked] [ref=e65]
          - radio "Modified" [ref=e66]
          - radio "Name" [ref=e67]
          - radio "Created" [ref=e68]
          - radio "Size" [ref=e69]
        - button "Sort descending" [ref=e70]:
          - img [ref=e71]
      - radiogroup "View" [ref=e73]:
        - radio "Grid" [checked] [ref=e74]:
          - img [ref=e75]
          - text: Grid
        - radio "List" [ref=e80]:
          - img [ref=e81]
          - text: List
  - main [ref=e82]:
    - grid "File grid" [ref=e83]:
      - row "Design 1, image, just now Design 2, figma, 23 hr ago Design 3, strata, yesterday Design 4, strata, 2 days ago" [ref=e84]:
        - gridcell "Design 1, image, just now" [ref=e85]:
          - generic [ref=e86]:
            - text: Design 1
            - generic [ref=e87]: imagejust now1.0 KB
        - gridcell "Design 2, figma, 23 hr ago" [ref=e88]:
          - generic [ref=e89]:
            - text: Design 2
            - generic [ref=e90]: figma23 hr ago2.0 KB
        - gridcell "Design 3, strata, yesterday" [ref=e91]:
          - generic [ref=e92]:
            - text: Design 3
            - generic [ref=e93]: stratayesterday3.0 KB
        - gridcell "Design 4, strata, 2 days ago" [ref=e94]:
          - generic [ref=e95]:
            - text: Design 4
            - generic [ref=e96]: strata2 days ago4.0 KB
      - row "Design 5, strata, 3 days ago" [ref=e97]:
        - gridcell "Design 5, strata, 3 days ago" [ref=e98]:
          - generic [ref=e99]:
            - text: Design 5
            - generic [ref=e100]: strata3 days ago5.0 KB
  - dialog "New file" [ref=e104]:
    - generic [ref=e105]:
      - heading "New file" [level=2] [ref=e106]
      - button "Close dialog" [active] [ref=e107]: ×
    - generic [ref=e108]:
      - generic [ref=e109]:
        - button "Presets" [ref=e110] [cursor=pointer]
        - button "Templates" [ref=e111] [cursor=pointer]
      - generic [ref=e112]:
        - radiogroup "Category" [ref=e113]:
          - radio "All" [checked] [ref=e114]
          - radio "Blank" [ref=e115]
          - radio "Device" [ref=e116]
          - radio "Print" [ref=e117]
          - radio "Social" [ref=e118]
          - radio "UI" [ref=e119]
        - generic [ref=e120]:
          - button "Blank 1920 × 1080 px" [ref=e121] [cursor=pointer]:
            - generic [ref=e122]: Blank
            - generic [ref=e123]: 1920 × 1080 px
          - button "Web (1440px) 1440 × 900 px" [ref=e124] [cursor=pointer]:
            - generic [ref=e125]: Web (1440px)
            - generic [ref=e126]: 1440 × 900 px
          - button "Web (1024px) 1024 × 768 px" [ref=e127] [cursor=pointer]:
            - generic [ref=e128]: Web (1024px)
            - generic [ref=e129]: 1024 × 768 px
          - button "iPhone 15 Pro 393 × 852 px" [ref=e130] [cursor=pointer]:
            - generic [ref=e131]: iPhone 15 Pro
            - generic [ref=e132]: 393 × 852 px
          - button "iPad Air 820 × 1180 px" [ref=e133] [cursor=pointer]:
            - generic [ref=e134]: iPad Air
            - generic [ref=e135]: 820 × 1180 px
          - button "A4 210 × 297 mm" [ref=e136] [cursor=pointer]:
            - generic [ref=e137]: A4
            - generic [ref=e138]: 210 × 297 mm
          - button "A3 297 × 420 mm" [ref=e139] [cursor=pointer]:
            - generic [ref=e140]: A3
            - generic [ref=e141]: 297 × 420 mm
          - button "US Letter 215.9 × 279.4 mm" [ref=e142] [cursor=pointer]:
            - generic [ref=e143]: US Letter
            - generic [ref=e144]: 215.9 × 279.4 mm
          - button "Instagram Post 1080 × 1080 px" [ref=e145] [cursor=pointer]:
            - generic [ref=e146]: Instagram Post
            - generic [ref=e147]: 1080 × 1080 px
          - button "Instagram Story 1080 × 1920 px" [ref=e148] [cursor=pointer]:
            - generic [ref=e149]: Instagram Story
            - generic [ref=e150]: 1080 × 1920 px
          - button "Facebook Cover 1640 × 624 px" [ref=e151] [cursor=pointer]:
            - generic [ref=e152]: Facebook Cover
            - generic [ref=e153]: 1640 × 624 px
          - button "Presentation (16:9) 1920 × 1080 px" [ref=e154] [cursor=pointer]:
            - generic [ref=e155]: Presentation (16:9)
            - generic [ref=e156]: 1920 × 1080 px
        - generic [ref=e157]:
          - generic [ref=e158]:
            - generic [ref=e159]: Width
            - textbox "Width" [ref=e160]: "1920"
            - generic [ref=e161]: Height
            - textbox "Height" [ref=e162]: "1080"
          - generic [ref=e163]:
            - generic [ref=e164]: Unit
            - radiogroup "Unit" [ref=e165]:
              - radio "px" [checked] [ref=e166]
              - radio "pt" [ref=e167]
              - radio "in" [ref=e168]
              - radio "mm" [ref=e169]
            - generic [ref=e170]: Color
            - radiogroup "Color mode" [ref=e171]:
              - radio "RGB" [checked] [ref=e172]
              - radio "CMYK" [ref=e173]
      - generic [ref=e174]:
        - button "Cancel" [ref=e175]
        - button "Create" [ref=e176]
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | 
  3  | const TEST_PAGE = 'http://localhost:1420/e2e.html';
  4  | 
  5  | test.describe('Create file', () => {
  6  |   test.beforeEach(async ({ page }) => {
  7  |     await page.goto(TEST_PAGE);
  8  |     await page.waitForLoadState('networkidle');
  9  |     await page.waitForTimeout(500);
  10 |   });
  11 | 
  12 |   test('New File dialog opens on button click', async ({ page }) => {
  13 |     await page.getByRole('button', { name: /new file/i }).click();
  14 |     await page.waitForTimeout(500);
  15 |     await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });
  16 |   });
  17 | 
  18 |   test('dialog contains presets and templates tabs', async ({ page }) => {
  19 |     await page.getByRole('button', { name: /new file/i }).click();
  20 |     await page.waitForTimeout(500);
  21 |     await expect(page.getByText('Presets')).toBeVisible();
> 22 |     await expect(page.getByText('Blank')).toBeVisible();
     |                                           ^ Error: expect(locator).toBeVisible() failed
  23 |   });
  24 | });
  25 | 
```