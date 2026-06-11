"use client";

import { useRef, useState } from "react";
import { FiberConfig, normalizeFiberConfig } from "@/lib/fiberConfig";

type FiberAdminEditorProps = {
  config: FiberConfig;
  onChange: (config: FiberConfig) => void;
};

const SECTION_LABELS: Array<[keyof FiberConfig["sections"], string]> = [
  ["hero", "Hero"],
  ["quote", "Quote builder"],
  ["signup", "Sign-up info"],
  ["speedTest", "Speed test"],
  ["explanation", "Why fiber"],
  ["process", "Switching steps"],
  ["comparisonImages", "Comparison images"],
  ["faq", "FAQ"],
  ["contact", "Contact"],
];

const FONT_OPTIONS = [
  {
    label: "Inter clean",
    value: "Inter, Avenir Next, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  },
  {
    label: "Aptos modern",
    value: "Aptos, Segoe UI, Arial, sans-serif",
  },
  {
    label: "SF native",
    value: "-apple-system, BlinkMacSystemFont, SF Pro Display, SF Pro Text, Segoe UI, sans-serif",
  },
  {
    label: "IBM Plex feel",
    value: "IBM Plex Sans, Aptos, Segoe UI, Arial, sans-serif",
  },
  {
    label: "Neue clean",
    value: "Helvetica Neue, Arial, sans-serif",
  },
  {
    label: "Rounded friendly",
    value: "Aptos, Arial Rounded MT Bold, Segoe UI, Arial, sans-serif",
  },
];

export default function FiberAdminEditor({ config, onChange }: FiberAdminEditorProps) {
  const rawJsonRef = useRef<HTMLTextAreaElement>(null);
  const [rawMessage, setRawMessage] = useState("");

  function update(patch: Partial<FiberConfig>) {
    onChange(normalizeFiberConfig({ ...config, ...patch }));
  }

  function updateSection(key: keyof FiberConfig["sections"], value: boolean) {
    update({ sections: { ...config.sections, [key]: value } });
  }

  function updateHero(key: keyof FiberConfig["hero"], value: string) {
    update({ hero: { ...config.hero, [key]: value } });
  }

  function updateContact(key: keyof FiberConfig["contact"], value: string) {
    update({ contact: { ...config.contact, [key]: value } });
  }

  function updateTheme(key: keyof FiberConfig["theme"], value: string) {
    update({ theme: { ...config.theme, [key]: value } });
  }

  function updateQuote(key: keyof FiberConfig["quote"], value: string | number) {
    update({ quote: { ...config.quote, [key]: value } });
  }

  function updateProvider(index: number, patch: Partial<FiberConfig["quote"]["providers"][number]>) {
    update({
      quote: {
        ...config.quote,
        providers: config.quote.providers.map((provider, providerIndex) => providerIndex === index ? { ...provider, ...patch } : provider),
      },
    });
  }

  function updateProviderPlan(providerIndex: number, planIndex: number, patch: Partial<FiberConfig["quote"]["providers"][number]["plans"][number]>) {
    update({
      quote: {
        ...config.quote,
        providers: config.quote.providers.map((provider, index) => index === providerIndex ? {
          ...provider,
          plans: provider.plans.map((plan, nextPlanIndex) => nextPlanIndex === planIndex ? { ...plan, ...patch } : plan),
        } : provider),
      },
    });
  }

  function updateProviderAddon(providerIndex: number, addonIndex: number, patch: Partial<FiberConfig["quote"]["providers"][number]["addons"][number]>) {
    update({
      quote: {
        ...config.quote,
        providers: config.quote.providers.map((provider, index) => index === providerIndex ? {
          ...provider,
          addons: provider.addons.map((addon, nextAddonIndex) => nextAddonIndex === addonIndex ? { ...addon, ...patch } : addon),
        } : provider),
      },
    });
  }

  function updateProviderReward(providerIndex: number, patch: Partial<FiberConfig["quote"]["providers"][number]["reward"]>) {
    update({
      quote: {
        ...config.quote,
        providers: config.quote.providers.map((provider, index) => index === providerIndex ? {
          ...provider,
          reward: { ...provider.reward, ...patch },
        } : provider),
      },
    });
  }

  function updateProviderPromo(providerIndex: number, patch: Partial<FiberConfig["quote"]["providers"][number]["promo"]>) {
    update({
      quote: {
        ...config.quote,
        providers: config.quote.providers.map((provider, index) => index === providerIndex ? {
          ...provider,
          promo: { ...provider.promo, ...patch },
        } : provider),
      },
    });
  }

  function updateStringList(section: "explanation" | "process" | "signup", key: "bullets" | "steps" | "requiredInfo", value: string) {
    update({
      [section]: {
        ...config[section],
        [key]: value.split("\n").map(item => item.trim()).filter(Boolean),
      },
    } as Partial<FiberConfig>);
  }

  function updateFaq(index: number, patch: Partial<FiberConfig["faq"]["items"][number]>) {
    update({
      faq: {
        ...config.faq,
        items: config.faq.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
      },
    });
  }

  function updateSpeedLink(index: number, patch: Partial<FiberConfig["speedTest"]["links"][number]>) {
    update({
      speedTest: {
        ...config.speedTest,
        links: config.speedTest.links.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
      },
    });
  }

  function updateImageCard(index: number, patch: Partial<FiberConfig["comparisonImages"]["cards"][number]>) {
    update({
      comparisonImages: {
        ...config.comparisonImages,
        cards: config.comparisonImages.cards.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
      },
    });
  }

  function applyRawJson() {
    try {
      onChange(normalizeFiberConfig(JSON.parse(rawJsonRef.current?.value || "{}")));
      setRawMessage("Applied JSON.");
    } catch (error) {
      setRawMessage(error instanceof Error ? error.message : "Invalid JSON.");
    }
  }

  return (
    <section className="adminPanel fiberAdminPanel">
      <div className="pathBuilderTop">
        <div>
          <p className="kicker">Fiber OS</p>
          <h2>Edit the private fiber page</h2>
        </div>
      </div>

      <section className="fiberAdminBlock">
        <h3>Section visibility</h3>
        <div className="adminChecks fiberAdminChecks">
          {SECTION_LABELS.map(([key, label]) => (
            <label key={key}>
              <input type="checkbox" checked={config.sections[key]} onChange={event => updateSection(key, event.target.checked)} />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="fiberAdminBlock">
        <h3>Contact and photo</h3>
        <div className="twoInputs">
          <label>
            <span>Phone label</span>
            <input className="input" value={config.contact.phoneLabel} onChange={event => updateContact("phoneLabel", event.target.value)} />
          </label>
          <label>
            <span>Phone href digits</span>
            <input className="input" value={config.contact.phoneHref} onChange={event => updateContact("phoneHref", event.target.value)} />
          </label>
          <label>
            <span>Email</span>
            <input className="input" value={config.contact.email} onChange={event => updateContact("email", event.target.value)} />
          </label>
          <label>
            <span>Photo URL</span>
            <input className="input" value={config.hero.photoUrl} onChange={event => updateHero("photoUrl", event.target.value)} placeholder="/fiber/jj.jpg" />
          </label>
        </div>
        <label>
          <span>Default text message</span>
          <textarea value={config.contact.textBody} onChange={event => updateContact("textBody", event.target.value)} />
        </label>
      </section>

      <section className="fiberAdminBlock">
        <h3>Hero copy</h3>
        <div className="twoInputs">
          <label>
            <span>Kicker</span>
            <input className="input" value={config.hero.kicker} onChange={event => updateHero("kicker", event.target.value)} />
          </label>
          <label>
            <span>Headline</span>
            <input className="input" value={config.hero.headline} onChange={event => updateHero("headline", event.target.value)} />
          </label>
        </div>
        <label>
          <span>Main body</span>
          <textarea value={config.hero.body} onChange={event => updateHero("body", event.target.value)} />
        </label>
        <label>
          <span>JJU note</span>
          <textarea value={config.hero.jjuNote} onChange={event => updateHero("jjuNote", event.target.value)} />
        </label>
        <label>
          <span>Photo card note</span>
          <input className="input" value={config.hero.cardNote} onChange={event => updateHero("cardNote", event.target.value)} />
        </label>
      </section>

      <section className="fiberAdminBlock">
        <h3>Palette and font</h3>
        <div className="fiberAdminColorGrid">
          <label>
            <span>Kinetic green</span>
            <input className="input" type="color" value={config.theme.accent} onChange={event => updateTheme("accent", event.target.value)} />
          </label>
          <label>
            <span>Fiber bright</span>
            <input className="input" type="color" value={config.theme.accent2} onChange={event => updateTheme("accent2", event.target.value)} />
          </label>
          <label>
            <span>Frontier red</span>
            <input className="input" type="color" value={config.theme.frontier} onChange={event => updateTheme("frontier", event.target.value)} />
          </label>
          <label>
            <span>Ink</span>
            <input className="input" type="color" value={config.theme.ink} onChange={event => updateTheme("ink", event.target.value)} />
          </label>
        </div>
        <div className="twoInputs">
          <label>
            <span>Font picker</span>
            <select className="select" value={config.theme.font} onChange={event => updateTheme("font", event.target.value)}>
              <option value={config.theme.font}>Current custom</option>
              {FONT_OPTIONS.map(option => <option key={option.label} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Font stack</span>
            <input className="input" value={config.theme.font} onChange={event => updateTheme("font", event.target.value)} />
          </label>
        </div>
      </section>

      <section className="fiberAdminBlock">
        <h3>Quote settings</h3>
        <div className="twoInputs">
          <label>
            <span>Quote eyebrow</span>
            <input className="input" value={config.quote.eyebrow} onChange={event => updateQuote("eyebrow", event.target.value)} />
          </label>
          <label>
            <span>Quote title</span>
            <input className="input" value={config.quote.title} onChange={event => updateQuote("title", event.target.value)} />
          </label>
          <label>
            <span>Default current bill</span>
            <input className="input" type="number" value={config.quote.currentBillDefault} onChange={event => updateQuote("currentBillDefault", Number(event.target.value))} />
          </label>
          <label>
            <span>Bill shortcut buttons</span>
            <input
              className="input"
              value={config.quote.currentBillPresets.join(", ")}
              onChange={event => update({ quote: { ...config.quote, currentBillPresets: event.target.value.split(",").map(item => Number(item.trim())).filter(Number.isFinite) } })}
            />
          </label>
          <label>
            <span>Default provider ID</span>
            <input className="input" value={config.quote.defaultProviderId} onChange={event => updateQuote("defaultProviderId", event.target.value)} />
          </label>
        </div>
        <label>
          <span>Disclaimer</span>
          <textarea value={config.quote.disclaimer} onChange={event => updateQuote("disclaimer", event.target.value)} />
        </label>
      </section>

      <section className="fiberAdminBlock">
        <h3>Provider plans</h3>
        <div className="fiberAdminRows">
          {config.quote.providers.map((provider, providerIndex) => (
            <section className="tagGroupCard" key={provider.id || providerIndex}>
              <h3>{provider.name}</h3>
              <div className="twoInputs">
                <input className="input" value={provider.id} onChange={event => updateProvider(providerIndex, { id: event.target.value })} aria-label="Provider ID" />
                <input className="input" value={provider.name} onChange={event => updateProvider(providerIndex, { name: event.target.value })} aria-label="Provider name" />
                <input className="input" value={provider.badge} onChange={event => updateProvider(providerIndex, { badge: event.target.value })} aria-label="Provider badge" />
                <input className="input" value={provider.primaryPlanId} onChange={event => updateProvider(providerIndex, { primaryPlanId: event.target.value })} aria-label="Primary plan ID" />
                <input className="input" value={provider.planHeading} onChange={event => updateProvider(providerIndex, { planHeading: event.target.value })} aria-label="Plan heading" />
                <input className="input" value={provider.summaryLabel} onChange={event => updateProvider(providerIndex, { summaryLabel: event.target.value })} aria-label="Summary label" />
              </div>
              {provider.plans.map((plan, planIndex) => (
                <div className="fiberAdminRow" key={plan.id || planIndex}>
                  <input className="input" value={plan.id} onChange={event => updateProviderPlan(providerIndex, planIndex, { id: event.target.value })} aria-label="Plan ID" />
                  <input className="input" value={plan.name} onChange={event => updateProviderPlan(providerIndex, planIndex, { name: event.target.value })} aria-label="Plan name" />
                  <input className="input" value={plan.speed} onChange={event => updateProviderPlan(providerIndex, planIndex, { speed: event.target.value })} aria-label="Plan speed" />
                  <input className="input" type="number" value={plan.price} onChange={event => updateProviderPlan(providerIndex, planIndex, { price: Number(event.target.value) })} aria-label="Plan price" />
                  <input className="input" value={plan.badge} onChange={event => updateProviderPlan(providerIndex, planIndex, { badge: event.target.value })} aria-label="Plan badge" />
                  <textarea value={plan.details} onChange={event => updateProviderPlan(providerIndex, planIndex, { details: event.target.value })} aria-label="Plan details" />
                </div>
              ))}
            </section>
          ))}
        </div>
      </section>

      <section className="fiberAdminBlock">
        <h3>Provider add-ons, rewards, and promos</h3>
        <div className="fiberAdminRows">
          {config.quote.providers.map((provider, providerIndex) => (
            <section className="tagGroupCard" key={`${provider.id}-addons`}>
              <h3>{provider.name}</h3>
              <div className="fiberAdminThree">
                {provider.addons.map((addon, addonIndex) => (
                  <AddonEditor
                    key={addon.id || addonIndex}
                    title={addon.name || "Add-on"}
                    addon={addon}
                    onChange={patch => updateProviderAddon(providerIndex, addonIndex, patch)}
                  />
                ))}
                <section className="tagGroupCard">
                  <h3>Reward card</h3>
                  <label className="toggleLine"><input type="checkbox" checked={provider.reward.enabled} onChange={event => updateProviderReward(providerIndex, { enabled: event.target.checked })} /> Enabled</label>
                  <label className="toggleLine"><input type="checkbox" checked={provider.reward.selectedByDefault} onChange={event => updateProviderReward(providerIndex, { selectedByDefault: event.target.checked })} /> Selected by default</label>
                  <input className="input" value={provider.reward.name} onChange={event => updateProviderReward(providerIndex, { name: event.target.value })} />
                  <input className="input" type="number" value={provider.reward.amount} onChange={event => updateProviderReward(providerIndex, { amount: Number(event.target.value) })} />
                  <textarea value={provider.reward.description} onChange={event => updateProviderReward(providerIndex, { description: event.target.value })} />
                </section>
                <section className="tagGroupCard">
                  <h3>Promo logic</h3>
                  <label className="toggleLine"><input type="checkbox" checked={provider.promo.enabled} onChange={event => updateProviderPromo(providerIndex, { enabled: event.target.checked })} /> Enabled</label>
                  <input className="input" value={provider.promo.name} onChange={event => updateProviderPromo(providerIndex, { name: event.target.value })} aria-label="Promo name" />
                  <input className="input" value={provider.promo.freeMonths.join(", ")} onChange={event => updateProviderPromo(providerIndex, { freeMonths: event.target.value.split(",").map(item => Number(item.trim())).filter(Number.isFinite) })} aria-label="Free months" />
                  <input className="input" value={provider.promo.planIds.join(", ")} onChange={event => updateProviderPromo(providerIndex, { planIds: event.target.value.split(",").map(item => item.trim()).filter(Boolean) })} aria-label="Promo plan IDs" />
                  <textarea value={provider.promo.description} onChange={event => updateProviderPromo(providerIndex, { description: event.target.value })} />
                </section>
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="fiberAdminBlock">
        <h3>Info sections</h3>
        <div className="twoInputs">
          <label>
            <span>Why fiber title</span>
            <input className="input" value={config.explanation.title} onChange={event => update({ explanation: { ...config.explanation, title: event.target.value } })} />
          </label>
          <label>
            <span>Switching title</span>
            <input className="input" value={config.process.title} onChange={event => update({ process: { ...config.process, title: event.target.value } })} />
          </label>
        </div>
        <div className="twoInputs">
          <label>
            <span>Why fiber bullets, one per line</span>
            <textarea value={config.explanation.bullets.join("\n")} onChange={event => updateStringList("explanation", "bullets", event.target.value)} />
          </label>
          <label>
            <span>Switching steps, one per line</span>
            <textarea value={config.process.steps.join("\n")} onChange={event => updateStringList("process", "steps", event.target.value)} />
          </label>
        </div>
      </section>

      <section className="fiberAdminBlock">
        <h3>Sign-up info</h3>
        <label>
          <span>Title</span>
          <input className="input" value={config.signup.title} onChange={event => update({ signup: { ...config.signup, title: event.target.value } })} />
        </label>
        <label>
          <span>Body</span>
          <textarea value={config.signup.body} onChange={event => update({ signup: { ...config.signup, body: event.target.value } })} />
        </label>
        <label>
          <span>Required info, one per line</span>
          <textarea value={config.signup.requiredInfo.join("\n")} onChange={event => updateStringList("signup", "requiredInfo", event.target.value)} />
        </label>
        <label>
          <span>Verification/autopay note</span>
          <textarea value={config.signup.verificationNote} onChange={event => update({ signup: { ...config.signup, verificationNote: event.target.value } })} />
        </label>
      </section>

      <section className="fiberAdminBlock">
        <h3>Speed-test links</h3>
        <label>
          <span>Title</span>
          <input className="input" value={config.speedTest.title} onChange={event => update({ speedTest: { ...config.speedTest, title: event.target.value } })} />
        </label>
        <label>
          <span>Body</span>
          <textarea value={config.speedTest.body} onChange={event => update({ speedTest: { ...config.speedTest, body: event.target.value } })} />
        </label>
        <div className="fiberAdminRows">
          {config.speedTest.links.map((link, index) => (
            <div className="fiberAdminRow compact" key={`${link.url}-${index}`}>
              <input className="input" value={link.label} onChange={event => updateSpeedLink(index, { label: event.target.value })} aria-label="Speed link label" />
              <input className="input" value={link.url} onChange={event => updateSpeedLink(index, { url: event.target.value })} aria-label="Speed link URL" />
              <input className="input" value={link.note} onChange={event => updateSpeedLink(index, { note: event.target.value })} aria-label="Speed link note" />
            </div>
          ))}
        </div>
      </section>

      <section className="fiberAdminBlock">
        <h3>Comparison image slots</h3>
        <label>
          <span>Title</span>
          <input className="input" value={config.comparisonImages.title} onChange={event => update({ comparisonImages: { ...config.comparisonImages, title: event.target.value } })} />
        </label>
        <label>
          <span>Body</span>
          <textarea value={config.comparisonImages.body} onChange={event => update({ comparisonImages: { ...config.comparisonImages, body: event.target.value } })} />
        </label>
        <div className="fiberAdminRows">
          {config.comparisonImages.cards.map((card, index) => (
            <div className="fiberAdminRow compact" key={`${card.title}-${index}`}>
              <input className="input" value={card.title} onChange={event => updateImageCard(index, { title: event.target.value })} aria-label="Image card title" />
              <input className="input" value={card.imageUrl} onChange={event => updateImageCard(index, { imageUrl: event.target.value })} aria-label="Image card URL" placeholder="/fiber/coax.png" />
              <input className="input" value={card.body} onChange={event => updateImageCard(index, { body: event.target.value })} aria-label="Image card body" />
            </div>
          ))}
        </div>
      </section>

      <section className="fiberAdminBlock">
        <h3>FAQs</h3>
        <label>
          <span>FAQ title</span>
          <input className="input" value={config.faq.title} onChange={event => update({ faq: { ...config.faq, title: event.target.value } })} />
        </label>
        <div className="fiberAdminRows">
          {config.faq.items.map((item, index) => (
            <div className="fiberAdminRow faq" key={`${item.question}-${index}`}>
              <input className="input" value={item.question} onChange={event => updateFaq(index, { question: event.target.value })} aria-label="FAQ question" />
              <textarea value={item.answer} onChange={event => updateFaq(index, { answer: event.target.value })} aria-label="FAQ answer" />
            </div>
          ))}
        </div>
      </section>

      <details className="fiberAdminBlock">
        <summary>Advanced JSON editor</summary>
        <textarea className="fiberRawJson" key={JSON.stringify(config)} ref={rawJsonRef} defaultValue={JSON.stringify(config, null, 2)} />
        <div className="adminActions">
          <button className="formBtn" onClick={applyRawJson}>Apply JSON</button>
          {rawMessage && <span className="adminInlineNote">{rawMessage}</span>}
        </div>
      </details>
    </section>
  );
}

function AddonEditor({
  title,
  addon,
  onChange,
}: {
  title: string;
  addon: FiberConfig["quote"]["providers"][number]["addons"][number];
  onChange: (patch: Partial<FiberConfig["quote"]["providers"][number]["addons"][number]>) => void;
}) {
  return (
    <section className="tagGroupCard">
      <h3>{title}</h3>
      <label className="toggleLine"><input type="checkbox" checked={addon.enabled} onChange={event => onChange({ enabled: event.target.checked })} /> Enabled</label>
      <label className="toggleLine"><input type="checkbox" checked={addon.selectedByDefault} onChange={event => onChange({ selectedByDefault: event.target.checked })} /> Selected by default</label>
      {addon.id && <input className="input" value={addon.id} onChange={event => onChange({ id: event.target.value })} aria-label={`${title} ID`} />}
      <input className="input" value={addon.name} onChange={event => onChange({ name: event.target.value })} />
      <input className="input" type="number" value={addon.price} onChange={event => onChange({ price: Number(event.target.value) })} />
      <input className="input" value={addon.promoNote || ""} onChange={event => onChange({ promoNote: event.target.value })} aria-label={`${title} promo note`} placeholder="Promo note, like one month free" />
      <input className="input" value={(addon.freeMonths || []).join(", ")} onChange={event => onChange({ freeMonths: event.target.value.split(",").map(item => Number(item.trim())).filter(Number.isFinite) })} aria-label={`${title} free months`} placeholder="Free months, like 1" />
      <textarea value={addon.description} onChange={event => onChange({ description: event.target.value })} />
      {addon.channels && (
        <label>
          <span>Channels, comma-separated</span>
          <textarea value={addon.channels.join(", ")} onChange={event => onChange({ channels: event.target.value.split(",").map(item => item.trim()).filter(Boolean) })} />
        </label>
      )}
    </section>
  );
}
