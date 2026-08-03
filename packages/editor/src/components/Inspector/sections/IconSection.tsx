/**
 * IconSection — controls for a selected document icon node.
 *
 * Shows when a single selected node carries an `iconAssetId` reference.
 * Provides: name/provider/licence/attribution provenance, replace (opens the
 * icon browser in replace mode), and detach (converts to plain editable
 * nodes while preserving geometry).
 *
 * Research basis: Figma component instance controls, image-fill provenance
 * panels in design tools (licence + attribution must be visible before
 * export decisions).
 */

import type { SceneNode } from '@strata/scene';
import { Button, Icon, Tooltip } from '@strata/ui';
import { useState } from 'react';
import { useEditor } from '../../../context';
import { IconBrowserDialog } from '../../IconBrowser/IconBrowserDialog';
import { DisclosureSection } from '../controls/DisclosureSection';
export function IconSection({ node }: { node: SceneNode }) {
  const editor = useEditor();
  const [replacing, setReplacing] = useState(false);
  const asset = node.iconAssetId ? editor.getIconAsset(node.iconAssetId) : undefined;

  if (!node.iconAssetId) return null;

  return (
    <DisclosureSection title="Icon" sectionId="icon">
      <div className="insp-icon">
        <div className="insp-icon__name">{asset?.name ?? node.name}</div>
        {asset?.prefix && (
          <div className="insp-icon__meta">
            Pack: {asset.prefix}
            {asset.providerId ? ` · ${asset.providerId}` : ''}
          </div>
        )}
        {asset?.licence && <div className="insp-icon__meta">Licence: {asset.licence}</div>}
        {asset?.attribution && (
          <div className="insp-icon__meta">Attribution: {asset.attribution}</div>
        )}
        {asset?.storageMode === 'linked' && (
          <div className="insp-icon__meta">Linked — checks for provider updates.</div>
        )}
        <div className="insp-icon__actions">
          <Button variant="secondary" size="sm" onClick={() => setReplacing(true)}>
            <Icon name="RefreshCw" size={14} />
            Replace…
          </Button>
          <Tooltip label="Detach converts the icon into plain editable paths. Its visual appearance is unchanged.">
            <Button variant="ghost" size="sm" onClick={() => editor.detachIconNodes([node.id])}>
              <Icon name="Unlink" size={14} />
              Detach
            </Button>
          </Tooltip>
        </div>
        <div className="insp-icon__hint">
          Icons are embedded in the document — they stay available offline and survive provider
          outages.
        </div>
      </div>
      <IconBrowserDialog
        open={replacing}
        onClose={() => setReplacing(false)}
        replaceNodeIds={[node.id]}
        title="Replace icon"
      />
    </DisclosureSection>
  );
}
