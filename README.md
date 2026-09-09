# SPT Ammo Graph

A read-only static snapshot of the SPT ammo scatter editor for GitHub Pages.

This deployment intentionally contains no server code, no database path, and no
write-back API. Dragging points and keyboard editing only change values in the
current browser session; nothing is sent to any server. The chart data is a
derived snapshot of ammo statistics, not the raw SPT database.

Source files for the local editor, including the optional write-back server,
remain in the parent `ammo_graph/` directory and are not part of this Pages
deployment.

To update this snapshot after changing `data.json`, `editor.js`, or
`index.html`, copy the sanitized static files here and push the repository.
