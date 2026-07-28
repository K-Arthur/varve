import { Button, useToast } from '@strata/ui';

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
  team: 'var(--color-feedback-danger)',
  enterprise: 'var(--color-accent)',
};

export function PlanBadge({ entitlement }: { entitlement: Entitlement }) {
  const isFree = entitlement.tier === 'free';
  const toast = useToast();

  return (
    <div className="plan-badge">
      <div className="plan-badge__tier" style={{ color: TIER_COLORS[entitlement.tier] }}>
        {TIER_LABELS[entitlement.tier]}
      </div>
      {isFree && (
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            toast.toast({
              message:
                'Strata is currently free during beta. Pricing will be announced before 1.0.',
              type: 'info',
            })
          }
        >
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
