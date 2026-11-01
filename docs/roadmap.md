# Roadmap

Every change to this file is proposed to and approved by the project owner before it is made. Agents and contributors
propose entries; they do not add, edit, reorder or remove them on their own.

## Later

### Load rarely used subsystems on demand

Split Blender's module by subsystem (for example OpenVDB, Bullet, the image libraries, the compositor, the sequencer,
Grease Pencil) so that each part downloads only when it is first needed. Bookmarked until the project is more mature,
because its safety is not yet established.

What is known (measured in Chromium 153):

- Chromium refuses synchronous compile and synchronous instantiation of modules over 8 MB on the main thread, so a
  part cannot be loaded at the moment Blender's code first calls into it.
- Asynchronous compile and instantiate have no size limit and can run in the background.
- Chromium already compiles WebAssembly functions on first call (the 60 MB module compiles in about 0.25 s), so the
  gain is download size, not compile time.
- JSPI is available, but it suspends only calls entered from asynchronous exports; Bylonder calls the module
  synchronously.

The risk: Blender code reaching a part that has not finished loading, through a path that did not wait for it, stops
in the middle of an operation and can leave Blender's data inconsistent.

The proposed safeguards, to be proven before this is done:

- Each part lists what needs it (operators, modifier types, file types); Bylonder awaits the part before calling in.
- All parts load in the background right after startup.
- A test mode that holds back the background load and fails on any call into a part that is not loaded, run over the
  whole unit and browser test suites.
