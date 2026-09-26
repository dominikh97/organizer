# Organizer

A simple, Google Keep–style notes organizer that runs entirely in the browser. It has no build step, no dependencies and no server. Notes are saved in your browser's `localStorage`.

## Features

- Quick note composer ("Take a note…") with title and body
- Checklists: turn a note into a checklist and back, tick items off right on the card
- Pinned notes shown in their own section
- 10 background colors
- Labels: create, rename and delete them in "Edit labels", filter by label from the sidebar
- Archive, and a Trash that empties itself after 7 days
- Undo for archive and delete
- Live search across titles, bodies, checklist items and labels
- Drag and drop to reorder notes
- Light and dark theme, and a layout that works on phones
- Export and import a JSON backup
- Keyboard shortcuts: `/` focuses search, `c` starts a new note

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Publish with GitHub Pages

1. On GitHub, go to **Settings → Pages**.
2. Under **Build and deployment**, pick **Deploy from a branch**, then choose your branch and the `/ (root)` folder.
3. Your organizer will be live at `https://<your-username>.github.io/organizer/`.

Notes stay in each browser's local storage. Use **Export backup** and **Import backup** to move them between devices.

## Files

| File         | Purpose                                     |
|--------------|---------------------------------------------|
| `index.html` | Page layout, the editor and the label dialogs |
| `style.css`  | Styling, note colors, light and dark themes |
| `app.js`     | State, storage, rendering and interactions  |
