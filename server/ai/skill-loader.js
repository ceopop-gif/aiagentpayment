import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const cache = new Map();

async function readText(path) {
  if (cache.has(path)) return cache.get(path);
  const text = await readFile(path, 'utf8');
  cache.set(path, text);
  return text;
}

export async function loadMasterSkill() {
  return readText(join(root, 'SKILL.md'));
}

export async function loadDomainSkill(name) {
  if (!name) return '';
  try {
    return await readText(join(root, 'skills', `${name}.md`));
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

export async function buildSkillContext(domain) {
  // Billing is a core policy, not an optional feature. Every AI command must
  // understand subscription/token rules before it reasons about a domain action.
  const [master, billingSkill, domainSkill] = await Promise.all([
    loadMasterSkill(),
    loadDomainSkill('billing'),
    domain && domain !== 'billing' ? loadDomainSkill(domain) : Promise.resolve('')
  ]);

  return [
    '# MASTER SKILL',
    master,
    billingSkill ? `\n# CORE BILLING & AI TOKEN POLICY\n${billingSkill}` : '',
    domainSkill ? `\n# DOMAIN SKILL: ${domain}\n${domainSkill}` : ''
  ].join('\n');
}

export function clearSkillCache() {
  cache.clear();
}
