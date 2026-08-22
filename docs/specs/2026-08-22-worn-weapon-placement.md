# Worn weapon placement

How a weapon is put in a hand, in terms that do not depend on a camera. Written after the wand was
moved four times off screenshots, each time in a direction only a screen could name.

## The frame

World axes are the build scene's, Blender's Z-up (`tools/build_wardrobe.py`):

| direction | axis | how it was measured |
|---|---|---|
| his forward | `-Y` | `HELM_BACK_SHIFT` seats the helm backwards along `+Y` |
| up | `+Z` | the head's bounding box tops out in `+Z` |
| his right | `-X` | `hand_r` head sits at x -0.706, `hand_l` at +0.706 |

The client is Babylon's Y-up and mirrors X, so his right reads `+X` there. Nothing in the fitter
uses client axes.

## The three rules

1. **A weapon is aimed against the clip he stands in, never the rest pose.** `Rig|Idle_Loop` is
   imported, the hand's rest-to-posed transform is read at the middle frame, and the piece is
   rotated so its own long axis lands on `WAND_AIM` once the clip has turned the hand. The rig is
   put back in its rest pose before export and the function asserts it. Measured on the built glb:
   the wand's principal axis in the idle pose is (-0.196, -0.785, 0.588) against a `WAND_AIM` of
   (-0.20, -0.78, 0.59).

2. **The grip point is the hole the closed fist makes, read in the pose.** The rest hand is open,
   so the hole does not exist in it: predicting one from the knuckle line put the shaft beside the
   fist twice. `fist_centre` averages the sixteen joints of the four fingers as the clip curls them,
   and the result is carried back through the same transform into the rest space the mesh is
   authored in. Measured: the fist's centroid sits 2.8 mm off the shaft's axis.

3. **A shaft is sized by the hole, not by the length that looks right.** The hole in this fist is
   about 20 mm across - the roomiest point inside it clears the skin by 10.0 mm. `WAND_GRIP_DIA`
   is 28 mm, which leaves about a millimetre of the median shaft inside the fingers and reads as a
   hand closing on wood. Length is then bought by stretching the donor along its own long axis
   only, capped at `WAND_MAX_STRETCH`, because a hand can feel a fatter grip and an eye reads a
   longer one.

## Current numbers

| knob | value | what moves |
|---|---|---|
| `WAND_AIM` | (-0.20, -0.78, 0.59) | where the head points in the idle pose: ahead and a third of a right angle up |
| `WAND_GRIP_DIA` | 0.028 m | shaft across the fist; sizing the whole piece follows from it |
| `WAND_LEN_RATIO` | 0.23 of body height | wanted length; reached only if the stretch cap allows |
| `WAND_MAX_STRETCH` | 1.8 | past this the carving smears. At 28 mm the wand lands at 340 mm |

## Verifying a fit

Numbers alone have passed on every wrong placement so far. Both halves are required:

- Offline, in the pose: `tools/build_wardrobe.py` prints the fit report to
  `assets/characters/gear-fit.json`. A measurement taken in the bind pose is worthless.
- In the client: `?viewer`, with `window.__viewer = { scene, camera }` in dev. Set
  `camera.target` to the piece's `boundingBox.centerWorld` after
  `refreshBoundingInfo({applySkeleton: true})` - without `applySkeleton` the box is the bind pose -
  then orbit. Alpha near 3.14 puts the camera inside the torso; 2.09 and 4.19 at beta 1.15 and
  radius 0.45 both show the right hand and the whole weapon.

## Open

- Only the wand is fitted this way. The buckler is strapped to the forearm and the helm is seated on
  the skull; neither is a grip.
- The ears and the lower nape are outside every helm measurement. Four attempts at an automatic
  "is skin through the steel" test failed on an open-brimmed shell, so helm width has a floor an eye
  set (`HELM_WIDTH_FROM`), not a number the fitter proves.
