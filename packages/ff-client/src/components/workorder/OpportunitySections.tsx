// Plan-only sections for recipe assignments with per-minute rates, and for the
// opportunities the foreman spotted: collectibles, overclocking, AWESOME-shop
// suggestions and notes.

import type {
  CollectibleOpportunity,
  RecipeAssignment,
  WorkOrderOpportunities,
} from '../../api/types.js';
import { Collapsible } from './Collapsible.js';
import { COLLECTIBLE_LABEL, metres } from './format.js';

/** The machine/recipe assignments, with per-minute in/out rates. Plan-only. */
export function RecipesSection({
  recipes,
}: {
  recipes: RecipeAssignment[];
}): React.JSX.Element | null {
  if (recipes.length === 0) {
    return null;
  }
  const rates = (r: RecipeAssignment): string | null => {
    const fmt = (items: { itemName: string; perMinute: number }[]): string =>
      items.map((it) => `${it.itemName} ${it.perMinute}/min`).join(' + ');
    const inputs = r.inputItems !== undefined && r.inputItems.length > 0 ? fmt(r.inputItems) : null;
    const outputs =
      r.outputItems !== undefined && r.outputItems.length > 0 ? fmt(r.outputItems) : null;
    // One-sided assignments (a generator consumes, an extractor produces) read
    // as words rather than a dangling arrow.
    if (inputs !== null && outputs !== null) {
      return `${inputs} → ${outputs}`;
    }
    if (inputs !== null) {
      return `consumes ${inputs}`;
    }
    if (outputs !== null) {
      return `produces ${outputs}`;
    }
    return null;
  };
  return (
    <Collapsible label="Recipes">
      <div className="ledger">
        {recipes.map((r, i) => {
          const io = rates(r);
          return (
            <div className="row tall" key={r.id ?? i}>
              <span className="check-body">
                {r.machineName}
                {io !== null ? <span className="check-note">{io}</span> : null}
                {r.notes !== undefined ? <span className="check-note">{r.notes}</span> : null}
              </span>
              <span className="qty muted">{r.recipeName}</span>
            </div>
          );
        })}
      </div>
    </Collapsible>
  );
}

function CollectibleGroup({
  title,
  items,
}: {
  title: string;
  items: CollectibleOpportunity[];
}): React.JSX.Element | null {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="collectible-group">
      <span className="label sub">{title}</span>
      {items.map((c, i) => (
        <div className="collectible" key={c.id ?? i}>
          <span className="check-body">
            {COLLECTIBLE_LABEL[c.kind]}
            {c.reason !== undefined ? <span className="check-note">{c.reason}</span> : null}
          </span>
          <span className="qty muted">
            {c.distance !== undefined ? metres(c.distance) : ''}
            {c.optional ? <span className="optional"> optional</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Everything opportunistic the Foreman spotted around the order: collectibles
 * near the player and the site, overclocking options, AWESOME-shop suggestions
 * and freeform opportunity notes. Plan-only.
 */
export function OpportunitySections({
  opportunities,
}: {
  opportunities?: WorkOrderOpportunities;
}): React.JSX.Element | null {
  if (opportunities === undefined) {
    return null;
  }
  const opp = opportunities;
  const hasCollectibles =
    (opp.nearbyCollectiblesFromPlayer?.length ?? 0) > 0 ||
    (opp.nearbyCollectiblesFromWorkOrderLocation?.length ?? 0) > 0;
  const overclocking = opp.overclockingOptions ?? [];
  const shop = opp.awesomeShopSuggestions ?? [];
  const notes = opp.notes ?? [];
  if (!hasCollectibles && overclocking.length === 0 && shop.length === 0 && notes.length === 0) {
    return null;
  }
  return (
    <>
      {hasCollectibles ? (
        <Collapsible label="Nearby Collectibles">
          <CollectibleGroup title="Near you" items={opp.nearbyCollectiblesFromPlayer ?? []} />
          <CollectibleGroup
            title="Near work-order site"
            items={opp.nearbyCollectiblesFromWorkOrderLocation ?? []}
          />
        </Collapsible>
      ) : null}

      {overclocking.length > 0 ? (
        <Collapsible label="Overclocking">
          <div className="ledger">
            {overclocking.map((oc, i) => (
              <div className="row tall" key={i}>
                <span className="check-body">
                  {oc.target}
                  <span className="check-note">{oc.recommendation}</span>
                  {oc.expectedEffect !== undefined ? (
                    <span className="check-note">{oc.expectedEffect}</span>
                  ) : null}
                  {oc.notes !== undefined ? <span className="check-note">{oc.notes}</span> : null}
                </span>
                <span className="qty muted">
                  {oc.powerShardCount !== undefined
                    ? `${oc.powerShardCount} shard${oc.powerShardCount === 1 ? '' : 's'}`
                    : ''}
                </span>
              </div>
            ))}
          </div>
        </Collapsible>
      ) : null}

      {shop.length > 0 ? (
        <Collapsible label="AWESOME Shop">
          <div className="ledger">
            {shop.map((s, i) => (
              <div className="row tall" key={i}>
                <span className="check-body">
                  {s.itemName}
                  <span className="check-note">{s.reason}</span>
                </span>
                <span className="qty muted">{s.priority ?? ''}</span>
              </div>
            ))}
          </div>
        </Collapsible>
      ) : null}

      {notes.length > 0 ? (
        <Collapsible label="Opportunity Notes">
          <ul className="fm-notes">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Collapsible>
      ) : null}
    </>
  );
}
