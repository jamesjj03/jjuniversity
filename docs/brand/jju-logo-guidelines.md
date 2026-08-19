# JJ University Logo Guidelines

Status: Approved by James Johnson on 2026-08-18
Geometry source: `public/branding/jju/logo-geometry.json`

## Core idea

Two identical Js sit inside one U. The three letterforms are constructed as one balanced monogram rather than typeset as unrelated characters.

The monogram is the primary identity. It should not contain a book, star, shield, column, cap, laurel, or other symbol.

## Authoritative construction

- View box: 100 by 106 units
- Overall width: 100 units
- Overall height: 106 units
- U weight: 14 units through the verticals and lower bowl
- J stem width: 12 units
- U interior width at the open top: 72 units
- Js begin 16 units below the U top
- Clear gap between the two vertical J stems: 12 units
- J pair occupies approximately 48 percent of the U width
- Bottom clearance between the J hooks and inner U curve: approximately 20 units
- Ends are square
- The J hooks are broad custom silhouettes with slightly chiseled terminals
- Curves are smooth and geometric without reducing the Js to centerline strokes
- The mark is symmetrical around its central axis as an overall composition

The large Primary Mark panel in the supplied presentation is the visual authority. The presentation's smaller variants and numeric annotations are not geometry references because they are internally inconsistent. Generate every production asset from `logo-geometry.json`; the recorded silhouette is the approved production geometry.

## Palette

- Gold: `#D4A24C`
- Cream: `#F7F5F1`
- Charcoal: `#1F1F1F`
- Deep navy: `#0D1117`
- Near black: `#0A0A0A`
- White: `#FFFFFF`

Gold is the primary mark color. Near black or charcoal can be used on light backgrounds. Cream or white can be used on dark backgrounds when a monochrome treatment is required.

Do not add gradients, bevels, shadows, outlines, or decorative effects to the mark itself.

## Lockup

The website lockup places the monogram to the left of the live `JJ University` wordmark. The website should keep the wordmark as real text so it remains crisp, accessible, and consistent with the current Bricolage Grotesque brand typography.

The exported lockup SVGs are reference and convenience files. The monogram geometry, not the text rendering in those files, is authoritative.

## Minimum size and clear space

- Monogram minimum height: 24px
- Horizontal lockup minimum width: 80px
- Preferred website mark height: 42px to 48px
- Minimum clear space on every side: the visible height of one J stem

At very small sizes, use the monogram alone.

## Generated deliverables

- Gold, cream, charcoal, near-black, and white SVG marks
- Transparent PNG marks from 24px through 1024px
- Dark and light horizontal lockup SVGs
- 16px, 32px, and 48px multi-image favicon
- 192px, 512px, and 1024px app icons
- 180px Apple touch icon
- V2 route icon and Apple touch icon

Run `node scripts/generate-jju-brand-assets.mjs` after changing the authoritative geometry or palette.
