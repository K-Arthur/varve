import { Button } from '@strata/ui';

export interface Entitlement {
  tier: 'free' | 'pro' | 'team' | 'enterprise';
  features: string[];
  expiresAt?: number;
}

const TIER_LABELS: Record<Entitlement['tier'], string> = {
  free: 'Free',
  pro: 'Pro',
  team: 'Team',
  enterprise: 'Enterprise',
};

const TIER_COLORS: Record<Entitlement['tier'], string> = {
  free: 'var(--color-text-muted)',
  pro: 'var(--color-accent)',
  team: '#e06c75',
  enterprise: '#c678dd',
};

export function PlanBadge({ entitlement }: { entitlement: Entitlement }) {
  const isFree = entitlement.tier === 'free';

  return (
    <div className="plan-badge">
      <div className="plan-badge__tier" style={{ color: TIER_COLORS[entitlement.tier] }}>
        {TIER_LABELS[entitlement.tier]}
      </div>
      {isFree && (
        <Button variant="primary" size="sm" onClick={() => {}}>
          Upgrade
        </Button>
      )}
      {!isFree && entitlement.expiresAt && (
        <div className="plan-badge__expiry">
          Expires {new Date(entitlement.expiresAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
