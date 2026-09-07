(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.__YY_MODEL_LABELS__ = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PAID_SOL_PLANS = new Set(['plus', 'pro', 'business', 'enterprise', 'edu', 'education', 'team']);
  const LUNA_PLANS = new Set(['free', 'go']);

  const clean = (value) => String(value || '').trim();
  const lower = (value) => clean(value).toLowerCase();

  function planFamily(plan) {
    const p = lower(plan).replace(/\s+/g, '_');
    if (LUNA_PLANS.has(p)) return 'Luna';
    if (PAID_SOL_PLANS.has(p)) return 'Sol';
    return '';
  }

  function explicitFamily(slug) {
    const s = lower(slug);
    if (/(?:^|[-_:])sol(?:$|[-_:])/.test(s)) return 'Sol';
    if (/(?:^|[-_:])luna(?:$|[-_:])/.test(s)) return 'Luna';
    if (/(?:^|[-_:])terra(?:$|[-_:])/.test(s)) return 'Terra';
    if (/(?:^|[-_:])astra(?:$|[-_:])/.test(s)) return 'Astra';
    return '';
  }

  function familyFromUi(ui) {
    const s = lower(ui);
    if (/\bsol\b/.test(s)) return 'Sol';
    if (/\bluna\b/.test(s)) return 'Luna';
    if (/\bterra\b/.test(s)) return 'Terra';
    if (/\bastra\b/.test(s)) return 'Astra';
    return '';
  }

  function isWorkLike(turn) {
    const haystack = [
      turn?.flags?.product_experience,
      turn?.flags?.turn_use_case,
      turn?.ui,
      turn?.api
    ].map(lower).join(' ');
    return /\b(work|codex|agent|agentic)\b/.test(haystack) || /astra-wm/.test(haystack);
  }

  function inferred56Family(slug, turn) {
    const explicit = explicitFamily(slug);
    if (explicit) return explicit;

    const uiFamily = familyFromUi(turn?.ui);
    if (uiFamily) return uiFamily;

    // In standard Chat, current plan mapping is stable enough to make the label useful:
    // Free/Go -> Luna; eligible paid plans -> Sol. Work/Codex can route among several
    // GPT-5.6 family members, so do not infer a family there without explicit evidence.
    if (!isWorkLike(turn)) return planFamily(turn?.flags?.plan_type);
    return '';
  }

  function reasoningSuffix(slug, turn) {
    const s = lower(slug);
    const effort = lower(turn?.effort);
    if (/extra[-_ ]?high|xhigh|extra_high/.test(effort)) return 'Extra High';
    if (/\bhigh\b/.test(effort)) return 'High';
    if (/\bmedium\b/.test(effort)) return 'Medium';
    if (/\blow\b/.test(effort)) return 'Low';
    if (/thinking|reasoning|think/.test(s)) return 'Thinking';
    if (/instant/.test(s)) return 'Instant';
    if (/auto/.test(s)) return 'Auto';
    if (/(?:^|[-_:])pro(?:$|[-_:])/.test(s)) return 'Pro';
    return '';
  }

  function formatVersion(major, minor) {
    return minor == null ? `GPT-${major}` : `GPT-${major}.${minor}`;
  }

  function formatKnownSlug(slug, turn) {
    const raw = clean(slug);
    const s = lower(raw);
    if (!raw) return '';

    // GPT-5.6 family. Family is shown only when explicit or safely inferred.
    if (/^gpt[-_:]?5[-_.:]?6(?:$|[-_:])/.test(s)) {
      const family = inferred56Family(raw, turn);
      const suffix = reasoningSuffix(raw, turn);
      const base = family ? `GPT-5.6 ${family}` : 'GPT-5.6';
      return suffix ? `${base} · ${suffix}` : base;
    }

    // GPT-6 Astra internal slugs seen in Work/Codex.
    if (/^gpt[-_:]?6(?:$|[-_:])/.test(s)) {
      const family = explicitFamily(raw);
      const suffix = /(?:^|[-_:])wm(?:$|[-_:])/.test(s) ? 'Work' : reasoningSuffix(raw, turn);
      const base = family ? `GPT-6 ${family}` : 'GPT-6';
      return suffix ? `${base} · ${suffix}` : base;
    }

    // Generic GPT x.y slugs such as gpt-5-5-mini.
    const gpt = s.match(/^gpt[-_:]?(\d+)(?:[-_.:](\d+))?(?:[-_:](.*))?$/);
    if (gpt) {
      const base = formatVersion(gpt[1], gpt[2]);
      const tail = clean(gpt[3]).replace(/[-_:]+/g, ' ');
      if (!tail) return base;
      const pretty = tail.replace(/\bmini\b/i, 'Mini').replace(/\bthinking\b/i, 'Thinking').replace(/\binstant\b/i, 'Instant');
      return `${base} · ${pretty}`;
    }

    // OpenAI o-series slugs.
    const o = s.match(/^(o\d+(?:[-_.]\d+)?)(?:[-_:](.*))?$/);
    if (o) {
      const base = o[1].toUpperCase();
      const tail = clean(o[2]).replace(/[-_:]+/g, ' ');
      return tail ? `${base} · ${tail}` : base;
    }

    return raw;
  }

  function friendlyModelName(slug, turn) {
    return formatKnownSlug(slug, turn) || clean(slug);
  }

  function friendlyModelList(slugs, turn) {
    const values = Array.isArray(slugs) ? slugs : [slugs];
    return values.filter(Boolean).map((slug) => friendlyModelName(slug, turn)).join(' / ');
  }

  return { friendlyModelName, friendlyModelList, explicitFamily, planFamily, isWorkLike };
});
