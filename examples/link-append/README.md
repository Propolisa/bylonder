# Link and Append

A street at dusk set dressed from a library, made in Blender 5.2 by `link-append.py` (`blender -b --factory-startup -P
link-append.py`) and opened here with Blender's own reader.

- **Library.** `libraries/library.blend`: the Street Lamp collection (Post, Lantern and Lamp Light), the Bench outside
  it and the Cobblestone material, which no object uses. A project keeps the libraries it links from in its
  `libraries` folder.
- **Link.** File > Link, choose library.blend, open Collection and double click Street Lamp: an empty instances the
  linked collection; the street has eight of them. Object > Library Override > Make turns one into local overrides.
- **Append.** File > Append, choose library.blend, open Object and double click Bench: a local copy, with its mesh.
  Cobblestone is appended from Material onto the road.
