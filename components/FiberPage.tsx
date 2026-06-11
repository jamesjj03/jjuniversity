"use client";

import { useEffect, useState } from "react";
import { DEFAULT_FIBER_CONFIG, FiberConfig, FiberPlan, FiberProvider, normalizeFiberConfig } from "@/lib/fiberConfig";

const FIBER_VISITED_KEY = "jjuFiberVisited";
const REWARD_START_MONTH = 4;
const INTERNET_USES = [
  { id: "tv", label: "TV / streaming" },
  { id: "gaming", label: "Gaming" },
  { id: "work", label: "Work from home" },
  { id: "school", label: "School / homework" },
  { id: "cameras", label: "Cameras / smart home" },
  { id: "uploading", label: "Uploading / creating" },
];

type LeadForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  currentProvider: string;
  devices: string;
  uses: string[];
  question: string;
};

function parseMoney(value: string) {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function money(value: number) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function wholeMoney(value: number) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(value)).toLocaleString()}`;
}

function smsHref(contact: FiberConfig["contact"], body?: string) {
  const encoded = encodeURIComponent(body || contact.textBody || "");
  return `sms:${contact.phoneHref}${encoded ? `?&body=${encoded}` : ""}`;
}

function getDefaultProvider(config: FiberConfig) {
  return config.quote.providers.find((provider) => provider.id === config.quote.defaultProviderId) || config.quote.providers[0];
}

function defaultAddonSelections(provider: FiberProvider | undefined) {
  return Object.fromEntries((provider?.addons || []).map((addon) => [addon.id, Boolean(addon.selectedByDefault)]));
}

function findPlan(provider: FiberProvider | undefined, matcher: (plan: FiberPlan) => boolean) {
  return provider?.plans.find(matcher);
}

function getRecommendedPlan(provider: FiberProvider | undefined, form: LeadForm) {
  if (!provider) return { plan: undefined, reason: "The 1 Gig plan is usually the starting point." };

  const deviceCount = Number(form.devices || 0);
  const uses = new Set(form.uses);
  const oneGig = findPlan(provider, (plan) => plan.id === provider.primaryPlanId)
    || findPlan(provider, (plan) => /1\s*Gig/i.test(plan.speed))
    || provider.plans[0];
  const lowest = provider.plans[0] || oneGig;
  const twoGig = findPlan(provider, (plan) => /2\s*Gig/i.test(plan.speed));
  const fiveGig = findPlan(provider, (plan) => /5\s*Gig/i.test(plan.speed));
  const sevenGig = findPlan(provider, (plan) => /7\s*Gig/i.test(plan.speed));
  const heavyUse = uses.has("gaming") || uses.has("work") || uses.has("cameras") || uses.has("uploading");
  const heavyUseCount = form.uses.filter((item) => ["gaming", "work", "cameras", "uploading"].includes(item)).length;
  const lightUseOnly = form.uses.length > 0 && form.uses.every((item) => item === "tv" || item === "school");

  if (deviceCount > 0 && deviceCount <= 2 && lightUseOnly) {
    return { plan: lowest, reason: "Small setup, light use. This is the only time I would really look below 1 Gig." };
  }

  if ((deviceCount >= 60 || (deviceCount >= 45 && heavyUseCount >= 3)) && sevenGig) {
    return { plan: sevenGig, reason: "Extreme device count. If this is real, I would look at the top Frontier tier instead of trying to squeeze it." };
  }

  if ((deviceCount >= 35 || (deviceCount >= 25 && uses.has("uploading"))) && fiveGig) {
    return { plan: fiveGig, reason: "Very heavy device count or creator/upload usage. Worth looking above 2 Gig." };
  }

  if ((deviceCount >= 18 || (deviceCount >= 12 && heavyUse)) && twoGig) {
    return { plan: twoGig, reason: "Busy home with enough devices or heavier use to justify looking above 1 Gig." };
  }

  return { plan: oneGig, reason: "Best default for most homes. Enough room for streaming, gaming, work, and normal device load." };
}

export default function FiberPage() {
  const initialProvider = getDefaultProvider(DEFAULT_FIBER_CONFIG);
  const [config, setConfig] = useState<FiberConfig>(DEFAULT_FIBER_CONFIG);
  const [currentBill, setCurrentBill] = useState(DEFAULT_FIBER_CONFIG.quote.currentBillDefault);
  const [activeProviderId, setActiveProviderId] = useState(initialProvider?.id || "");
  const [activePlanId, setActivePlanId] = useState(initialProvider?.primaryPlanId || initialProvider?.plans[0]?.id || "");
  const [addonSelections, setAddonSelections] = useState<Record<string, boolean>>(defaultAddonSelections(initialProvider));
  const [rewardSelected, setRewardSelected] = useState(Boolean(initialProvider?.reward.selectedByDefault));
  const [heroPhotoBroken, setHeroPhotoBroken] = useState(false);
  const [leadForm, setLeadForm] = useState<LeadForm>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    currentProvider: "Spectrum",
    devices: "",
    uses: [],
    question: "",
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(FIBER_VISITED_KEY, "true");
      window.dispatchEvent(new Event("jju-fiber-visited"));
    } catch {}

    fetch("/fiber.json", { cache: "no-store" })
      .then(response => response.ok ? response.json() : DEFAULT_FIBER_CONFIG)
      .then(data => {
        const next = normalizeFiberConfig(data);
        const nextProvider = getDefaultProvider(next);
        setConfig(next);
        setCurrentBill(next.quote.currentBillDefault);
        setActiveProviderId(nextProvider?.id || "");
        setActivePlanId(nextProvider?.primaryPlanId || nextProvider?.plans[0]?.id || "");
        setAddonSelections(defaultAddonSelections(nextProvider));
        setRewardSelected(Boolean(nextProvider?.reward.selectedByDefault));
        setHeroPhotoBroken(false);
      })
      .catch(() => {});
  }, []);

  const activeProvider = config.quote.providers.find((provider) => provider.id === activeProviderId) || getDefaultProvider(config);
  const activePlan = activeProvider?.plans.find((plan) => plan.id === activePlanId) || activeProvider?.plans[0];
  const enabledAddons = activeProvider?.addons.filter((addon) => addon.enabled) || [];
  const selectedAddons = enabledAddons.filter((addon) => addonSelections[addon.id]);

  function selectProvider(provider: FiberProvider) {
    setActiveProviderId(provider.id);
    setActivePlanId(provider.primaryPlanId || provider.plans[0]?.id || "");
    setAddonSelections(defaultAddonSelections(provider));
    setRewardSelected(Boolean(provider.reward.selectedByDefault));
  }

  function resetQuote() {
    const provider = getDefaultProvider(config);
    setCurrentBill(config.quote.currentBillDefault);
    if (provider) {
      selectProvider(provider);
    }
  }

  const quote = (() => {
    const base = Number(activePlan?.price || 0);
    const addonTotal = roundMoney(selectedAddons.reduce((sum, addon) => sum + Number(addon.price || 0), 0));
    const monthly = roundMoney(base + addonTotal);
    const monthlyDifference = roundMoney(currentBill - monthly);
    const reward = activeProvider?.reward.enabled && rewardSelected ? Number(activeProvider.reward.amount || 0) : 0;
    const promoApplies = Boolean(
      activeProvider?.promo.enabled &&
      activePlan?.id &&
      activeProvider.promo.planIds.includes(activePlan.id)
    );

    function monthSubtotal(month: number) {
      const freeBase = promoApplies && activeProvider?.promo.freeMonths.includes(month);
      const monthlyAddonTotal = selectedAddons.reduce((sum, addon) => {
        const addonFree = (addon.freeMonths || []).includes(month);
        return sum + (addonFree ? 0 : Number(addon.price || 0));
      }, 0);
      return roundMoney((freeBase ? 0 : base) + monthlyAddonTotal);
    }

    function buildRows(count: number) {
      let rewardRemaining = reward;

      return Array.from({ length: count }, (_, index) => {
        const month = index + 1;
        const subtotal = monthSubtotal(month);
        const rewardApplied = month >= REWARD_START_MONTH ? Math.min(subtotal, rewardRemaining) : 0;
        rewardRemaining = roundMoney(rewardRemaining - rewardApplied);

        return {
          month,
          rewardApplied,
          promoApplied: promoApplies && activeProvider?.promo.freeMonths.includes(month),
          outOfPocket: roundMoney(Math.max(0, subtotal - rewardApplied)),
        };
      });
    }

    const monthRows = buildRows(5);
    const firstYearRows = buildRows(12);
    const firstFiveCurrent = roundMoney(currentBill * 5);
    const firstFiveProvider = roundMoney(monthRows.reduce((sum, row) => sum + row.outOfPocket, 0));
    const firstYearCurrent = roundMoney(currentBill * 12);
    const firstYearProvider = roundMoney(firstYearRows.reduce((sum, row) => sum + row.outOfPocket, 0));
    const threeYearCurrent = roundMoney(currentBill * 36);
    const threeYearProvider = roundMoney(firstYearProvider + monthly * 24);

    return {
      base,
      addonTotal,
      monthly,
      monthlyDifference,
      firstFiveCurrent,
      firstFiveProvider,
      firstFiveSavings: roundMoney(firstFiveCurrent - firstFiveProvider),
      firstYearSavings: roundMoney(firstYearCurrent - firstYearProvider),
      threeYearSavings: roundMoney(threeYearCurrent - threeYearProvider),
      reward,
      promoApplies,
      monthRows,
    };
  })();

  const currentBillPresets = config.quote.currentBillPresets.length ? config.quote.currentBillPresets : [80, 100, 120];

  function adjustCurrentBill(amount: number) {
    setCurrentBill((value) => Math.max(0, roundMoney(value + amount)));
  }

  function setAddonSelected(id: string) {
    setAddonSelections((value) => ({ ...value, [id]: !value[id] }));
  }

  function updateLeadField(field: keyof LeadForm, value: string) {
    setLeadForm((current) => ({ ...current, [field]: value }));
  }

  function toggleLeadUse(id: string) {
    setLeadForm((current) => ({
      ...current,
      uses: current.uses.includes(id) ? current.uses.filter((item) => item !== id) : [...current.uses, id],
    }));
  }

  const navItems = [
    config.sections.quote && { id: "quote", label: "Quote" },
    config.sections.signup && { id: "signup", label: "Sign up" },
    config.sections.speedTest && { id: "speed", label: "Speed test" },
    config.sections.explanation && { id: "why-fiber", label: "Why fiber" },
    config.sections.process && { id: "switching", label: "Switching" },
    config.sections.faq && { id: "faq", label: "FAQ" },
    config.sections.contact && { id: "contact", label: "Contact" },
  ].filter(Boolean) as Array<{ id: string; label: string }>;
  const providerColor = activeProvider?.id === "frontier" ? config.theme.frontier : config.theme.accent;
  const recommendation = getRecommendedPlan(activeProvider, leadForm);
  const recommendedMonthly = recommendation.plan ? roundMoney(recommendation.plan.price + quote.addonTotal) : 0;
  const leadName = `${leadForm.firstName} ${leadForm.lastName}`.trim();
  const leadUses = leadForm.uses.map((id) => INTERNET_USES.find((item) => item.id === id)?.label || id);
  const leadSmsBody = [
    "Hey JJ, I'm interested in fiber.",
    leadName && `Name: ${leadName}`,
    leadForm.phone && `Phone: ${leadForm.phone}`,
    leadForm.email && `Email: ${leadForm.email}`,
    leadForm.currentProvider && `Current provider: ${leadForm.currentProvider}`,
    leadForm.devices && `Devices: ${leadForm.devices}`,
    leadUses.length ? `Internet use: ${leadUses.join(", ")}` : "",
    recommendation.plan && `Recommended plan: ${recommendation.plan.name} (${money(recommendedMonthly)}/mo)`,
    activeProvider && activePlan && `Current quote: ${activeProvider.name} - ${activePlan.name}, ${money(quote.monthly)}/mo vs current ${money(currentBill)}`,
    leadForm.question && `Question: ${leadForm.question}`,
  ].filter(Boolean).join("\n");

  return (
    <main
      className="fiberPage fiberPageV2"
      data-fiber-provider={activeProvider?.id || ""}
      style={{
        "--fiber-accent": providerColor,
        "--fiber-accent2": providerColor,
        "--fiber-frontier": config.theme.frontier,
        "--fiber-provider": providerColor,
        "--fiber-ink": config.theme.ink,
        "--fiber-font": config.theme.font,
        "--fiber-green": providerColor,
        "--fiber-green2": providerColor,
        "--fiber-coax": providerColor,
      } as React.CSSProperties}
    >
      {config.sections.hero && (
        <section className="fiberHeroV2">
          <div className="fiberHeroCopyV2">
            <p className="fiberEyebrow">{config.hero.kicker}</p>
            <h1>{config.hero.headline}</h1>
            <p>{config.hero.body}</p>
            <p className="fiberJjuNote">{config.hero.jjuNote}</p>
            <div className="fiberHeroActions">
              <a className="fiberBtn primary" href={smsHref(config.contact)}>Text JJ</a>
              <a className="fiberBtn secondary" href="#quote">Build quote</a>
            </div>
          </div>

          <div className="fiberRepPanel">
            {config.hero.photoUrl && !heroPhotoBroken ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={config.hero.photoUrl} alt={config.hero.photoAlt} onError={() => setHeroPhotoBroken(true)} />
            ) : (
              <div className="fiberPhotoPlaceholder">
                <span>JJ</span>
                <small>drop photo at /public/fiber/jj.jpg</small>
              </div>
            )}
            <p>{config.hero.cardNote}</p>
          </div>
        </section>
      )}

      <nav className="fiberPageNav" aria-label="Fiber page sections">
        {navItems.map(item => <a key={item.id} href={`#${item.id}`}>{item.label}</a>)}
      </nav>

      {config.sections.quote && (
        <section id="quote" className="fiberQuoteSection fiberQuoteV2">
          <div className="fiberSectionHeadV2">
            <p className="fiberEyebrow">{config.quote.eyebrow}</p>
            <h2>{config.quote.title}</h2>
          </div>

          <div className="fiberQuoteGrid">
            <div className="fiberQuoteControls">
              <section className="fiberPanelV2 fiberProviderPanel">
                <div className="fiberPanelTitle">
                  <span>01</span>
                  <h3>Provider</h3>
                </div>
                <div className="fiberProviderSwitch" role="radiogroup" aria-label="Fiber provider">
                  {config.quote.providers.map((provider) => (
                    <button
                      key={provider.id}
                      className={provider.id === activeProvider?.id ? "active" : ""}
                      type="button"
                      role="radio"
                      aria-checked={provider.id === activeProvider?.id}
                      onClick={() => selectProvider(provider)}
                    >
                      {provider.name}
                    </button>
                  ))}
                </div>
              </section>

              <section className="fiberPanelV2 fiberCurrentBillPanel">
                <div className="fiberPanelTitle">
                  <span>02</span>
                  <h3>Current provider bill</h3>
                </div>
                <label className="fiberMoneyInput">
                  <span>What are you paying now?</span>
                  <div>
                    <b>$</b>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="1"
                      value={currentBill}
                      onChange={(event) => setCurrentBill(parseMoney(event.target.value))}
                      onFocus={(event) => event.currentTarget.select()}
                      aria-label="Current monthly internet bill"
                    />
                  </div>
                </label>
                <div className="fiberBillShortcuts" aria-label="Current bill shortcuts">
                  <div className="fiberPresetGroup">
                    {currentBillPresets.map((preset) => (
                      <button
                        key={preset}
                        className={currentBill === preset ? "active" : ""}
                        type="button"
                        onClick={() => setCurrentBill(preset)}
                      >
                        ${preset}
                      </button>
                    ))}
                  </div>
                  <div className="fiberStepGroup">
                    <button type="button" aria-label="Lower current bill by five dollars" onClick={() => adjustCurrentBill(-5)}>-</button>
                    <strong>$5</strong>
                    <button type="button" aria-label="Raise current bill by five dollars" onClick={() => adjustCurrentBill(5)}>+</button>
                  </div>
                </div>
              </section>

              <section className="fiberPanelV2 fiberPlanPanel">
                <div className="fiberPanelTitle">
                  <span>03</span>
                  <h3>{activeProvider?.planHeading || "Fiber plan"}</h3>
                </div>
                <div className="fiberPlanGrid">
                  {(activeProvider?.plans || []).map((plan) => (
                    <PlanButton
                      key={plan.id}
                      plan={plan}
                      active={plan.id === activePlan?.id}
                      mostPicked={plan.id === activeProvider?.primaryPlanId}
                      monthly={roundMoney(plan.price + quote.addonTotal)}
                      onClick={() => setActivePlanId(plan.id)}
                    />
                  ))}
                </div>
                {activePlan && (
                  <div className="fiberSelectedPlanPanel">
                    <span>{activePlan.id === activeProvider?.primaryPlanId ? "Most picked" : "Selected speed"}</span>
                    <strong>{activePlan.name}</strong>
                    <p>{activePlan.details}</p>
                  </div>
                )}
              </section>

              <section className="fiberPanelV2 fiberAddonPanel">
                <div className="fiberPanelTitle">
                  <span>04</span>
                  <h3>Add-ons and promos</h3>
                </div>
                <div className="fiberAddonGrid">
                  {enabledAddons.map((addon) => (
                    <ToggleCard
                      key={addon.id}
                      active={Boolean(addonSelections[addon.id])}
                      title={addon.name}
                      promoNote={addon.promoNote}
                      price={`+${money(addon.price)}/mo`}
                      body={addon.description}
                      onClick={() => setAddonSelected(addon.id)}
                    >
                      {addon.channels && (
                        <details className="fiberChannelsFold">
                          <summary>
                            {(addon.channels || []).slice(0, 4).join(", ")}
                            {(addon.channels || []).length > 4 ? ` + ${(addon.channels || []).length - 4} more` : ""}
                          </summary>
                          <div className="fiberChannelGrid">
                            {(addon.channels || []).map((channel) => <span key={channel}>{channel}</span>)}
                          </div>
                        </details>
                      )}
                    </ToggleCard>
                  ))}
                  {activeProvider?.reward.enabled && (
                    <ToggleCard
                      active={rewardSelected}
                      title={activeProvider.reward.name}
                      price={money(activeProvider.reward.amount)}
                      body={activeProvider.reward.description}
                      onClick={() => setRewardSelected((value) => !value)}
                    />
                  )}
                </div>
              </section>
            </div>

            <aside className="fiberSummaryV2" aria-live="polite">
              <span className="fiberSummaryPill">Savings first</span>
              <div className="fiberBigSave">
                <small>Estimated 3-year savings</small>
                <strong>{wholeMoney(quote.threeYearSavings)}</strong>
              </div>
              <div className="fiberSummaryPair">
                <div>
                  <span>1-year savings</span>
                  <strong key={`year-${quote.firstYearSavings}`} className="fiberNumberPop">{wholeMoney(quote.firstYearSavings)}</strong>
                </div>
                <div>
                  <span>Monthly difference</span>
                  <strong key={`monthly-${quote.monthlyDifference}`} className={`${quote.monthlyDifference >= 0 ? "fiberGood" : "fiberBad"} fiberNumberPop`}>{money(quote.monthlyDifference)}</strong>
                </div>
              </div>
              <div className="fiberMonthlyCompare">
                <div>
                  <span>Current</span>
                  <strong>{money(currentBill)}</strong>
                </div>
                <div>
                  <span>{activeProvider?.summaryLabel || "Fiber"}</span>
                  <strong>{money(quote.monthly)}</strong>
                </div>
              </div>
              <section className="fiberFiveMonths">
                <div className="fiberFiveHeader">
                  <span>First 5 months</span>
                  <strong>{wholeMoney(quote.firstFiveSavings)} saved</strong>
                </div>
                <div className="fiberFiveCompare">
                  <div>
                    <span>Current provider</span>
                    <strong>{money(quote.firstFiveCurrent)}</strong>
                  </div>
                  <div>
                    <span>{activeProvider?.summaryLabel || "Fiber"}</span>
                    <strong>{money(quote.firstFiveProvider)}</strong>
                    {quote.reward > 0 && <em>after {money(quote.reward)} card</em>}
                  </div>
                </div>
                {quote.promoApplies && activeProvider?.promo.name && (
                  <div className="fiberRewardLine">
                    <span>{activeProvider.promo.name}</span>
                    <strong>Months 1-2</strong>
                  </div>
                )}
                {quote.reward > 0 && (
                  <div className="fiberRewardLine">
                    <span>Reward card impact</span>
                    <strong>-{money(quote.reward)}</strong>
                  </div>
                )}
                <div className="fiberMonthStrip">
                  {quote.monthRows.map((row) => (
                    <div key={row.month}>
                      <span>M{row.month}</span>
                      <strong>{money(row.outOfPocket)}</strong>
                      {row.promoApplied && <em>base waived</em>}
                      {row.rewardApplied > 0 && <em>{money(row.rewardApplied)} card</em>}
                    </div>
                  ))}
                </div>
              </section>
              <button
                className="fiberReset"
                type="button"
                onClick={resetQuote}
              >
                Reset quote
              </button>
              <p className="fiberDisclaimer">{config.quote.disclaimer}</p>
            </aside>
          </div>
        </section>
      )}

      <section className="fiberContentGridV2">
        {config.sections.signup && (
          <InfoPanel id="signup" title={config.signup.title} body={config.signup.body}>
            <div className="fiberChipGrid">
              {config.signup.requiredInfo.map(item => <span key={item}>{item}</span>)}
            </div>
            <p className="fiberNoteLine">{config.signup.verificationNote}</p>
          </InfoPanel>
        )}

        {config.sections.speedTest && (
          <InfoPanel id="speed" title={config.speedTest.title} body={config.speedTest.body}>
            <div className="fiberLinkList">
              {config.speedTest.links.map(link => (
                <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                  <strong>{link.label}</strong>
                  <span>{link.note}</span>
                </a>
              ))}
            </div>
          </InfoPanel>
        )}

        {config.sections.explanation && (
          <InfoPanel id="why-fiber" title={config.explanation.title}>
            <FiberFeatureGrid items={config.explanation.bullets} icons={["↑", "✓", "⌁", "◎", "↯"]} />
          </InfoPanel>
        )}

        {config.sections.process && (
          <InfoPanel id="switching" title={config.process.title}>
            <FiberFeatureGrid items={config.process.steps} numbered />
          </InfoPanel>
        )}
      </section>

      {config.sections.comparisonImages && (
        <section id="comparison" className="fiberComparisonSection">
          <div className="fiberSectionHeadV2">
            <p className="fiberEyebrow">Visual comparison</p>
            <h2>{config.comparisonImages.title}</h2>
            <p>{config.comparisonImages.body}</p>
          </div>
          <div className="fiberComparisonGrid">
            {config.comparisonImages.cards.map((card, index) => (
              <article className="fiberImageCard" key={`${card.title}-${index}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {card.imageUrl ? <img src={card.imageUrl} alt={card.title} /> : <div>Image slot</div>}
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {config.sections.faq && (
        <section id="faq" className="fiberFaqSection">
          <div className="fiberSectionHeadV2">
            <p className="fiberEyebrow">FAQ</p>
            <h2>{config.faq.title}</h2>
          </div>
          <div className="fiberFaqList">
            {config.faq.items.map((item) => (
              <details key={item.question} className="fiberFaqItem">
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {config.sections.contact && (
        <section id="contact" className="fiberContactV2">
          <div className="fiberContactIntro">
            <div>
              <p className="fiberEyebrow">Contact</p>
              <h2>Interested, or just have a question?</h2>
              <p>Fill this out if you want me to already know the basics. It does not save anywhere. It just formats a text to JJ.</p>
            </div>
            <div className="fiberContactActions">
              <a className="fiberBtn secondary" href={smsHref(config.contact)}>Text JJ</a>
              <a className="fiberBtn secondary" href={`tel:${config.contact.phoneHref}`}>Call JJ</a>
            </div>
          </div>
          <div className="fiberLeadGrid">
            <div className="fiberLeadForm" aria-label="Fiber interest form">
              <div className="fiberLeadFieldGrid">
                <label>
                  <span>First name</span>
                  <input value={leadForm.firstName} onChange={(event) => updateLeadField("firstName", event.target.value)} autoComplete="given-name" />
                </label>
                <label>
                  <span>Last name</span>
                  <input value={leadForm.lastName} onChange={(event) => updateLeadField("lastName", event.target.value)} autoComplete="family-name" />
                </label>
                <label>
                  <span>Email</span>
                  <input value={leadForm.email} onChange={(event) => updateLeadField("email", event.target.value)} type="email" autoComplete="email" />
                </label>
                <label>
                  <span>Phone</span>
                  <input value={leadForm.phone} onChange={(event) => updateLeadField("phone", event.target.value)} type="tel" inputMode="tel" autoComplete="tel" />
                </label>
                <label>
                  <span>Current provider</span>
                  <select value={leadForm.currentProvider} onChange={(event) => updateLeadField("currentProvider", event.target.value)}>
                    <option>Spectrum</option>
                    <option>Xfinity</option>
                    <option>Frontier</option>
                    <option>Kinetic</option>
                    <option>Other / not sure</option>
                  </select>
                </label>
                <label>
                  <span>Devices at home</span>
                  <input value={leadForm.devices} onChange={(event) => updateLeadField("devices", event.target.value)} type="number" min="0" inputMode="numeric" placeholder="10" />
                </label>
              </div>
              <fieldset className="fiberUsePicker">
                <legend>What do you use internet for?</legend>
                <div>
                  {INTERNET_USES.map((item) => (
                    <button
                      key={item.id}
                      className={leadForm.uses.includes(item.id) ? "active" : ""}
                      type="button"
                      onClick={() => toggleLeadUse(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="fiberQuestionBox">
                <span>Question or note</span>
                <textarea value={leadForm.question} onChange={(event) => updateLeadField("question", event.target.value)} rows={4} placeholder="Install timing, current bill, Wi-Fi issue, anything else..." />
              </label>
            </div>
            <aside className="fiberRecommendationPanel">
              <span>Quick recommendation</span>
              <strong>{recommendation.plan?.name || "Fiber 1 Gig"}</strong>
              <p>{recommendation.reason}</p>
              {recommendation.plan && (
                <div>
                  <b>{money(recommendedMonthly)}<small>/mo with selected add-ons</small></b>
                  {recommendation.plan.id !== activePlan?.id && (
                    <button type="button" onClick={() => setActivePlanId(recommendation.plan!.id)}>Use this in quote</button>
                  )}
                </div>
              )}
              <a className="fiberBtn primary" href={smsHref(config.contact, leadSmsBody)}>Text JJ with this info</a>
            </aside>
          </div>
          <p className="fiberContactFine">{config.contact.phoneLabel} / {config.contact.email}</p>
        </section>
      )}

      <div className="fiberMobileCta" aria-label="Quick fiber actions">
        <a href={smsHref(config.contact)}>Text JJ</a>
        <a href={`tel:${config.contact.phoneHref}`}>Call</a>
        <a href="#quote">Quote</a>
      </div>
    </main>
  );
}

function PlanButton({
  plan,
  active,
  mostPicked,
  monthly,
  onClick,
}: {
  plan: FiberPlan;
  active: boolean;
  mostPicked: boolean;
  monthly: number;
  onClick: () => void;
}) {
  return (
    <button className={active ? "fiberPlan active" : mostPicked ? "fiberPlan mostPicked" : "fiberPlan"} onClick={onClick} type="button">
      <span>{mostPicked ? "Most picked" : plan.badge}</span>
      <em>{plan.speed}</em>
      <b>{money(monthly)}<small>/mo</small></b>
      <small>{active ? "Selected" : "Tap to compare"}</small>
    </button>
  );
}

function ToggleCard({
  active,
  title,
  promoNote,
  price,
  body,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  promoNote?: string;
  price: string;
  body: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button className={active ? "fiberToggle active" : "fiberToggle"} onClick={onClick} type="button">
      <span className="fiberCheck">{active ? "On" : ""}</span>
      <div>
        <strong>{title}{promoNote && <small>{promoNote}</small>}</strong>
        <p>{body}</p>
        {children}
      </div>
      <b>{price}</b>
    </button>
  );
}

function InfoPanel({
  id,
  title,
  body,
  children,
}: {
  id: string;
  title: string;
  body?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="fiberInfoPanelV2">
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {children}
    </section>
  );
}


function FiberFeatureGrid({
  items,
  icons = [],
  numbered = false,
}: {
  items: string[];
  icons?: string[];
  numbered?: boolean;
}) {
  return (
    <div className="fiberFeatureGrid">
      {items.map((item, index) => (
        <article key={item} className="fiberFeatureCard">
          <span>{numbered ? String(index + 1).padStart(2, "0") : icons[index] || "•"}</span>
          <p>{item}</p>
        </article>
      ))}
    </div>
  );
}
