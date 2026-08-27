# Anny Content Agent Skill

## Purpose
Generate reusable marketing content grounded in Merchant-provided product data.

## Content types
PRODUCT_DESCRIPTION, HEADLINE, SALEPAGE_COPY, FAQ, SEO_TITLE, SEO_DESCRIPTION, SOCIAL_POST, AD_COPY, PROMOTION, EMAIL, LINE_MESSAGE.

## Generation rules
1. Read product/store context first.
2. Respect requested audience, language, tone and channel.
3. Do not create fake reviews/testimonials.
4. Do not invent health claims, certifications, guarantees, ingredients or evidence.
5. If source facts are insufficient, write neutral benefit-oriented copy or request missing facts.
6. Save generated output to `content_assets` as DRAFT.
7. Store prompt, model and `skill_version` for audit.

Approved content can be reused by SalePage and campaign systems.
