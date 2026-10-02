# Shop QA Demo Product Requirements

Version 1.0. Prepared for manual validation of AI QA Studio on 1 October 2026.

## Product and scope

Shop QA Demo is a local catalog website at http://127.0.0.1:4180/. A visitor can browse three products, search by product name, read product details and add a synthetic item to a cart. A health endpoint reports application availability. This PRD defines the expected behavior used to generate and review tests.

There are no user accounts, payments, order placement or real customer data. The separate demo control page is an operator tool and is outside the functional requirements. Its bug mode changes the implementation, not the expected behavior in this PRD.

## Requirement R01 Catalog homepage

The homepage must show the Shop QA Demo brand, a product search field and all three catalog products. Acceptance criteria: Wireless Mouse, Mechanical Keyboard and Studio Headphones are visible on a fresh homepage. The product count is 3. Each product has a price and a View details link.

## Requirement R02 Search query input

The search field must retain the exact text entered by the visitor before submission. Acceptance criteria: entering wireless mouse leaves the input value equal to wireless mouse. A visible Search button submits the query.

## Requirement R03 Product search results

Search must match product names case insensitively using substring matching after trimming surrounding spaces. Acceptance criteria: searching for MoUsE returns only Wireless Mouse and product count 1. Searching for zz_no_match_987 returns product count 0 and the visible message No products found. Submitting an empty query shows all three products again with product count 3.

## Requirement R04 Product details

Each View details link must open the matching product detail page on the same website. Acceptance criteria: Wireless Mouse opens /products/mouse and displays Wireless Mouse, its description, price ₹799 and a visible Add to cart button. Mechanical Keyboard costs ₹1299. Studio Headphones costs ₹2499.

## Requirement R05 Add item to cart

Adding Wireless Mouse once from a fresh product detail page must increase the visible cart count from 0 to 1. Acceptance criteria: the cart count is 1 after the request completes and the visible confirmation is Added to cart. This expected behavior applies in every test. A failure to add an item must be reported as a defect rather than redefining the expectation.

## Requirement R06 Application health

GET /api/health must return HTTP 200 and JSON containing the exact status value ok. Acceptance criteria: the response body contains the status property equal to ok and the application name Shop QA Demo.

## Catalog reference

| Product | Detail path | Price |
| --- | --- | ---: |
| Wireless Mouse | /products/mouse | ₹799 |
| Mechanical Keyboard | /products/keyboard | ₹1299 |
| Studio Headphones | /products/headphones | ₹2499 |

## Validation boundary

The supplied eight-case plan samples these six requirements. Review generated and uploaded assertions against every acceptance criterion. Passing this plan establishes those observed checks only. It does not certify performance, security, accessibility or exhaustive behavior. The cart starts at zero on each newly loaded product page and is not persisted across reloads.
