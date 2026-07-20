// Deterministic resume scorer inspired by HackerRank's open-sourced
// hiring-agent rubric: open source, self-directed projects, production
// experience, and technical skills, plus bonuses and deductions.
// No network calls, no LLM — pure text/pattern analysis so results are
// instant and reproducible.

let pdfjsPromise = null;
function getPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

const TIERS = [
  { name: 'Bronze', min: 0, cssClass: 'tier-bronze' },
  { name: 'Silver', min: 19, cssClass: 'tier-silver' },
  { name: 'Gold', min: 38, cssClass: 'tier-gold' },
  { name: 'Platinum', min: 57, cssClass: 'tier-platinum' },
  { name: 'Diamond', min: 76, cssClass: 'tier-diamond' },
  { name: 'Champion', min: 95, cssClass: 'tier-champion' },
];

function tierFor(score) {
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (score >= t.min) tier = t;
  }
  if (tier.name === 'Champion') {
    return { tier: tier.name, division: null, cssClass: tier.cssClass, label: 'Champion' };
  }
  const offset = score - tier.min;
  let division;
  if (offset < 6) division = 'III';
  else if (offset < 12) division = 'II';
  else division = 'I';
  return { tier: tier.name, division, cssClass: tier.cssClass, label: `${tier.name} ${division}` };
}

const SKILL_TERMS = [
  'python', 'java', 'javascript', 'typescript', 'c\\+\\+', 'c#', 'go', 'golang', 'rust',
  'ruby', 'php', 'swift', 'kotlin', 'scala', 'react', 'angular', 'vue', 'node', 'express',
  'django', 'flask', 'spring', 'rails', 'sql', 'postgres', 'mysql', 'mongodb', 'redis',
  'graphql', 'rest', 'docker', 'kubernetes', 'aws', 'gcp', 'azure', 'terraform', 'ansible',
  'jenkins', 'git', 'linux', 'bash', 'html', 'css', 'sass', 'tailwind', 'webpack', 'vite',
  'pandas', 'numpy', 'tensorflow', 'pytorch', 'scikit', 'spark', 'kafka', 'hadoop',
  'machine learning', 'deep learning', 'nlp', 'ci/cd', 'microservices', 'grpc', 'firebase',
];
const SKILL_RE = new RegExp(`\\b(${SKILL_TERMS.join('|')})\\b`, 'gi');

function countMatches(re, text) {
  const m = text.match(re);
  return m ? m.length : 0;
}

function zeroBreakdown() {
  return { open_source: 0, self_projects: 0, production: 0, technical_skills: 0, bonuses: 0, deductions: 0 };
}

function unscoreableResult() {
  return { score: 0, tier: null, division: null, label: 'Unranked', breakdown: zeroBreakdown(), unscoreable: true };
}

function analyzeText(rawText, links) {
  const text = rawText.toLowerCase();
  const linkText = links.join(' ').toLowerCase();
  const haystack = `${text}\n${linkText}`;
  const breakdown = zeroBreakdown();

  // --- open_source (max 35) ---
  let openSource = 0;
  if (/github\.com\//.test(haystack)) openSource += 10;
  const repoPaths = new Set((haystack.match(/github\.com\/[\w-]+\/[\w.-]+/g) || []));
  if (repoPaths.size >= 2) openSource += 5;
  if (/(open[- ]?source|contribut(ed|or|ions)\s+to|maintainer|pull request|merged pr)/.test(text)) openSource += 10;
  if (/(published .*(npm|pypi|package|crate)|npmjs\.com|pypi\.org)/.test(haystack)) openSource += 5;
  if (/\b\d[\d,]*\+?\s*(stars|downloads|forks)\b/.test(text)) openSource += 5;
  breakdown.open_source = Math.min(35, openSource);

  // --- self_projects (max 25) ---
  let selfProjects = 0;
  if (/^(personal |side )?projects\b/m.test(text)) selfProjects += 8;
  if (/(vercel\.app|netlify\.app|herokuapp\.com|github\.io|fly\.dev|render\.com|live demo|try it)/.test(haystack)) selfProjects += 6;
  const nonGithubLinks = new Set(
    (haystack.match(/https?:\/\/[^\s)]+/g) || []).filter((u) => !u.includes('github.com'))
  );
  if (nonGithubLinks.size >= 2) selfProjects += 5;
  if (/\((?:[a-z+#.]+,\s*){2,}/i.test(rawText)) selfProjects += 3;
  if (/hackathon/.test(text)) selfProjects += 3;
  breakdown.self_projects = Math.min(25, selfProjects);

  // --- production (max 40) ---
  let production = 0;
  if (/(experience|employment|work history)/.test(text)) production += 8;
  if (/(intern|engineer|developer|analyst).{0,80}(20\d\d|present)/.test(text)) production += 8;
  const impactHits = countMatches(
    /\b(reduced|increased|improved|grew|cut|saved|scaled)\b[^.\n]{0,60}\d+\s*(%|x|k|m|users|ms|hrs)/gi,
    rawText
  );
  production += Math.min(12, impactHits * 3);
  const actionVerbLines = countMatches(
    /^(built|led|shipped|designed|implemented|deployed|created|developed|automated|optimized)\b/gim,
    rawText
  );
  if (actionVerbLines >= 5) production += 6;
  if (/(production|ci\/cd|kubernetes|docker|aws|gcp|azure|monitoring|on[- ]call)/.test(text)) production += 6;
  breakdown.production = Math.min(40, production);

  // --- technical_skills (max 10) ---
  let technicalSkills = 0;
  if (/(skills|technologies|technical)/.test(text)) technicalSkills += 4;
  const distinctSkills = new Set((text.match(SKILL_RE) || []).map((s) => s.toLowerCase()));
  if (distinctSkills.size >= 8) technicalSkills += 6;
  else if (distinctSkills.size >= 4) technicalSkills += 3;
  breakdown.technical_skills = Math.min(10, technicalSkills);

  // --- bonuses (max 10) ---
  let bonuses = 0;
  if (/(award|winner|1st place|finalist|dean'?s list|scholarship)/.test(text)) bonuses += 4;
  if (/(b\.?s\.?|bachelor|master|ph\.?d)/.test(text) && /(computer science|engineering)/.test(text)) bonuses += 4;
  else if (/gpa:?\s*3\.[5-9]/.test(text)) bonuses += 4;
  if (/(certified|certification)/.test(text)) bonuses += 2;
  breakdown.bonuses = Math.min(10, bonuses);

  // --- deductions ---
  let deductions = 0;
  if (!/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(rawText)) deductions -= 5;
  if (!/\(?\d{3}\)?[\s.-]\d{3}/.test(rawText)) deductions -= 2;
  const totalLinks = nonGithubLinks.size + repoPaths.size + links.length;
  if (totalLinks === 0) deductions -= 5;
  breakdown.deductions = deductions;

  const raw = breakdown.open_source + breakdown.self_projects + breakdown.production +
    breakdown.technical_skills + breakdown.bonuses + breakdown.deductions;
  return { raw: Math.max(0, Math.min(120, raw)), breakdown };
}

async function extractPdfText(buffer) {
  const pdfjsLib = await getPdfjs();
  // pdf.js transfers/detaches the input buffer; the caller (server.js) keeps
  // the original Buffer alive for peer delivery, so we must hand it a copy.
  // Uint8Array.from (not .slice, which preserves the Buffer subclass via
  // Symbol.species) produces a plain Uint8Array — pdf.js rejects Buffers.
  const copy = Uint8Array.from(buffer);
  const loadingTask = pdfjsLib.getDocument({ data: copy, verbosity: 0 });
  const doc = await loadingTask.promise;
  try {
    let text = '';
    const links = [];
    const pageCount = Math.min(doc.numPages, 6);
    for (let n = 1; n <= pageCount; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      for (const item of content.items) {
        text += item.str;
        text += item.hasEOL ? '\n' : ' ';
      }
      const annotations = await page.getAnnotations();
      for (const a of annotations) {
        if (a.subtype === 'Link' && a.url) links.push(a.url);
      }
    }
    let numPages = doc.numPages;
    return { text, links, numPages };
  } finally {
    await loadingTask.destroy();
  }
}

async function scoreResume(buffer) {
  let extracted;
  try {
    extracted = await extractPdfText(buffer);
  } catch (err) {
    return unscoreableResult();
  }

  const { text, links, numPages } = extracted;
  if (!text || text.trim().length < 150) {
    return unscoreableResult();
  }

  const { raw, breakdown } = analyzeText(text, links);
  let pageDeduction = 0;
  if (numPages > 4) pageDeduction = -6;
  else if (numPages > 2) pageDeduction = -3;
  breakdown.deductions += pageDeduction;

  const adjustedRaw = Math.max(0, Math.min(120, raw + pageDeduction));
  const score = Math.round(adjustedRaw / 1.2);
  const { tier, division, cssClass, label } = tierFor(score);

  return { score, tier, division, cssClass, label, breakdown, unscoreable: false };
}

module.exports = { scoreResume, TIERS };
