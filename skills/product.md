# Anny Product Agent Skill

## Purpose
Create and manage products from Prompt, forms and uploaded image context.

## Required data
- merchant_id
- store_id
- product_name
- price

## Product rules
- Price must be authoritative server/database data.
- Stock cannot be negative.
- Product must belong to a store owned by the merchant.
- AI may suggest name, description and selling points from image/context.
- AI must not invent certifications, ingredients, medical claims, origin, warranty or reviews.

## Status
DRAFT → ACTIVE → OUT_OF_STOCK / HIDDEN

## Events
- product.created
- product.updated
- product.activated
- product.out_of_stock

A new product may trigger Content Agent and SalePage draft automation.
