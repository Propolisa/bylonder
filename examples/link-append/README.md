# Link and Append

Data-blocks brought in from another .blend by File > Link and File > Append, made in Blender 5.2 by `link-append.py`
(`blender -b --factory-startup -P link-append.py`) and opened here with Blender's own reader.

- **Library.** `libraries/library.blend`: the Props collection (Crate and Ball with their Wood and Rubber materials), the
  Lamp Post outside it and the Gold material, which no object uses. A project keeps the libraries it links from in its
  `libraries` folder.
- **Link.** File > Link, choose library.blend, open Collection and double click Props: an empty instances the linked
  collection. Object > Library Override > Make turns it into local overrides of the crate and the ball.
- **Append.** File > Append, choose library.blend, open Object and double click Lamp Post: a local copy, with its mesh.
