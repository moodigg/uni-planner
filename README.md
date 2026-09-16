# Uni Planner

A personal, offline planner: capture what you hear in class, and see your week.

Open `index.html` in a browser. No build step, no install, no account. Everything
is stored in that browser's `localStorage` under the key `uniplanner.v1` — nothing
is sent anywhere.

## Reminders tab

Quick capture parses plain text, so you can type it the way the lecturer said it:

| You type | You get |
|---|---|
| `final exam MATH201 next tuesday at 9am chapters 4 to 7 important` | Exam · MATH201 · Tue 22 Sep 9am · "Chapters 4–7" · High priority |
| `hw CS210 tmrw ch 3` | Assignment · CS210 · tomorrow · "Chapters 3" |
| `quiz PHY102 25/9` | Quiz · PHY102 · 25 Sep |
| `project presentation in 2 weeks` | Project · +14 days |

Recognised automatically:

- **Type** — exam/final/midterm, quiz, assignment/homework/hw/essay/report, project/presentation
- **Course** — `CS210`, `MATH 201`, `PHY-102`
- **Date** — today, tomorrow/tmrw, weekday names, `next tuesday`, `in 3 days`, `next week`, `25/9`, `sep 25`, `25 sep`
- **Time** — `at 10`, `10am`, `14:30`
- **Chapters** — `ch 3`, `chapters 3-5`, `ch 4 to 7`
- **Priority** — `!`, `important`, `urgent`

Whatever isn't recognised becomes the title. A live preview under the box shows
exactly what will be saved before you press Add, so a bad guess is visible up
front rather than after the fact.

Items group themselves into Overdue / Today / Tomorrow / This week / Later / No date,
and the tab badge counts anything overdue or due today.

The full form (the **New** button, or the pencil on any card) covers anything the
parser missed: type, course, due date and time, priority, and a free-text
chapters/details field.

## Schedule tab

Each session is one entry: course code, optional course name, **Lecture / Lab /
Tutorial**, day(s), start and end time, location, and instructor. Tick several
days at once and it creates one entry per day.

- **Week grid** — real time proportions, colour-coded by session type, today's
  column tinted with a live "now" line.
- **Day list** — the same data as cards; better on a phone.
- **Zoom** — on phones the week starts zoomed out so every class fits one screen,
  labelled with short names (Object Oriented Programming → OOP). Tap **Zoom in**,
  a day's header, or any class to widen that day with full details; the other
  days shrink and blur. Tap the day again, or **Whole week**, to zoom back out.
  On a PC the grid starts as before and the Zoom button is still there.
- **Today strip** — today's sessions plus a countdown to the next one.

## Themes

The **Theme** dropdown in the top bar switches the whole look; the sun/moon button
still flips light/dark inside whichever theme is active. Both choices are saved.

| Theme | Feel |
|---|---|
| **Classic** | The original: dark teal, clean cards |
| **Paper** | Printed planner: ruled paper, serif headings, handwritten labels, highlighter tags, sticky-note timetable |
| **Glass** | Frosted panels over a slow-moving aurora, cursor spotlight, glowing border while typing |

Motion (all themes) follows the Motion Primitives style — sliding tab/filter
highlight, staggered blur-in for new items, counting numbers, letter-by-letter
headings, springy dialogs, magnetic **New** button. It turns itself off when the
device asks for reduced motion, and data is always saved before any animation runs.

## Data

The `⋮` menu exports a `.json` backup and imports it back. Do this before
clearing browser data — `localStorage` is per-browser and per-device, so a
cleared cache or a different laptop means an empty app.

## Keyboard

| Key | Action |
|---|---|
| `N` | Focus quick capture (or open the class form on the Schedule tab) |
| `/` | Focus search |
| `←` `→` | Move between tabs when one is focused |
| `Esc` | Close a dialog |

## Design notes

Built against the UI/UX Pro Max "Productivity Tool" palette (teal focus + action
orange) and the "Accessible & Ethical" style profile:

- Every status carries a **text label**, never colour alone.
- Text contrast ≥ 4.5:1 in both themes; 3px focus rings on every control.
- 44×44px minimum touch targets.
- `prefers-reduced-motion` honoured; transitions capped at 220ms.
- Tested at 375 / 768 / 1024 / 1440px with no horizontal scroll.

## Files

```
index.html   markup, dialogs, theme applied before first paint
styles.css   Classic tokens + all components
themes.css   Paper and Glass (light + dark each)
motion.js    animation layer (no dependencies)
app.js       state, localStorage, the text parser, rendering
```

Colours live only as CSS custom properties in `styles.css` — change a token there
and it propagates everywhere, including the timetable blocks.
