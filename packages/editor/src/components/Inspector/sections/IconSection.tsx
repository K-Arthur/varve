/**
 * IconSection — controls for a selected document icon node.
 *
 * Shows when a single selected node carries an `iconAssetId` reference.
 * Provides: provenance (name, pack, source, SPDX licence, attribution),
 * replace (opens the icon browser in replace mode), detach (converts to
 * plain editable nodes while preserving geometry), and licence warnings.
 */

import type { SceneNode } from '@varve/scene';
import { Button, Icon, Tooltip } from '@varve/ui';
import { useState } from 'react';
import { useEditor } from '../../../context';
import { IconBrowserDialog } from '../../IconBrowser/IconBrowserDialog';
import { DisclosureSection } from '../controls/DisclosureSection';
export function IconSection({ node }: { node: SceneNode }) {
  const editor = useEditor();
  const [replacing, setReplacing] = useState(false);
  const asset = node.iconAssetId ? editor.getIconAsset(node.iconAssetId) : undefined;

  if (!node.iconAssetId) return null;

  const spdx = asset?.spdxId ?? asset?.licence;
  const attributionRequired = Boolean(asset?.attributionText || asset?.attribution);

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
        {asset?.canonicalId && <div className="insp-icon__meta">{asset.canonicalId}</div>}
        {spdx && (
          <div className="insp-icon__meta">
            Licence: {spdx}
            {asset?.licenceUrl && (
              <>
                {' — '}
                <a
                  href={asset.licenceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="insp-icon__link"
                >
                  terms
                </a>
              </>
            )}
          </div>
        )}
        {!spdx && (
          <div className="insp-icon__warn">
            Licence unknown — verify before commercial redistribution.
          </div>
        )}
        {asset?.attributionText && (
          <div className="insp-icon__meta">Attribution: {asset.attributionText}</div>
        )}
        {asset?.attribution && !asset.attributionText && (
          <div className="insp-icon__meta">Attribution: {asset.attribution}</div>
        )}
        {asset?.author && <div className="insp-icon__meta">Author: {asset.author}</div>}
        {asset?.sourceUrl && (
          <div className="insp-icon__meta">
            Source:{' '}
            <a
              href={asset.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="insp-icon__link"
            >
              {asset.sourceUrl.replace(/^https?:\/\//, '').slice(0, 40)}
            </a>
          </div>
        )}
        {asset?.paletteType === 'multicolor' && (
          <div className="insp-icon__meta">Multicolour — recolouring is limited.</div>
        )}
        {asset?.storageMode === 'linked' && (
          <div className="insp-icon__meta">Linked — checks for provider updates.</div>
        )}
        {attributionRequired && (
          <div className="insp-icon__note">
            This icon requires attribution in distributed work. It is included in the document
            attribution report at export time.
          </div>
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
          outages. Replacing keeps the icon's size, position, rotation, and effects.
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
