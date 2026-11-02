/**
 * Verbatim locked preset texts for Swap Studio.
 * NEVER modify, reword, shorten, reorder, or store these in React state.
 */

export type SwapPresetId = 'swap_v1' | 'swap_v2' | 'swap_v3_1' | 'swap_v1_sub_2';

export const SWAP_V1_TEXT = `SWAP PROMPT MAIN v1: PURE SUBJECT SWAPPING

IMAGE IDENTIFICATION (upload order does NOT matter. Identify each image by its content, never by its position):
- TEMPLATE = the real scene with person(s) in a pose and outfit. It is the master image.
- FACE = the close-up, chest-level, front-facing portrait of a woman looking at the camera. It is the identity reference for subject 1.
- MANNEQUIN = the full-figure gray/plastic 3D mannequin. It is the body blueprint for subject 1.
- MAN = a portrait of a man, optional. Use it only if TEMPLATE contains a second person; otherwise ignore it completely.

TASK:
Stay 100% true to TEMPLATE. Replace only the person(s) in it. Subject 1 becomes the woman from FACE, with the body of the MANNEQUIN, placed in the exact same spot, pose and outfit as the original person. Everything else in TEMPLATE stays untouched.

KEEP EXACTLY FROM TEMPLATE (do not change):
- Background, environment, objects, surfaces and depth of field
- Lighting (direction, softness, color temperature, shadows, highlights)
- Camera angle, camera height, distance, lens perspective, shot type, framing and crop
- Exact pose from toe to head (whatever is visible): joint angles, limb placement, hands, palms, fingers, legs, head tilt
- Exact gaze direction
- Exact facial expression (smile shape, eye openness, mouth, cheek and brow movement), re-expressed on the new face
- Exact outfit design, color, fabric, pattern, trims and details, refitted to the new body
- Subject's position in frame, sitting or standing point, eye-line height, and contact with furniture or objects
- Image ratio: output must be exactly the same as TEMPLATE

SUBJECT 1 FACE AND IDENTITY (from FACE only):
- Exact facial identity and geometry: face shape, eyes, nose, lips, jawline, cheeks, brows, ears
- Exact hairstyle and hair color (replaces TEMPLATE's hair)
- Exact skin tone, skin color, skin texture and skin detailing (pores, marks, natural tone variation), applied uniformly across all visible skin: face, neck, chest, arms, hands, legs
- Ornaments: take only the ornaments visible in FACE (earrings, chain, etc.). Remove all of TEMPLATE's original ornaments and jewelry.
- Do NOT take body, body shape, size, outfit, pose or background from FACE.
- No beautification, no polishing, no smoothing, no brightening, no reshaping.

SUBJECT 1 BODY (from MANNEQUIN only, HIGHEST PRIORITY):
- Subject 1's entire visible body (neck, shoulders, chest/bust, waist, abdomen, hips, arms, hands, thighs, knees, calves) must be an exact copy of the MANNEQUIN's shape, size, volume, build and proportions. Treat the mannequin as the real body. TEMPLATE only tells you how that body is posed.
- Discard the body of the original person in TEMPLATE completely. Discard the body of the person in FACE completely.
- If the mannequin is fuller, slimmer, taller, shorter or curvier than the original person, the new body must visibly be so.
- Study all mannequin views and match: head-to-body ratio, neck length, shoulder width, bust size and shape, waist width, waist-to-hip ratio, hip width, torso length, arm thickness, thigh and calf thickness, overall silhouette.
- Scale the head and neck to the mannequin's head-to-body ratio.
- Copy only shape and proportions. Do not copy the mannequin's gray material, seams, joints, face or pose.
- Show only the body parts visible in TEMPLATE's crop. Do not widen the frame to show the full figure.
- The outfit must stretch, tighten, loosen and fold according to the mannequin's body, not the original body, with natural fabric tension and shadows under TEMPLATE's lighting.

SUBJECT 2 (only if TEMPLATE has a second person):
- Replace him with the man from MAN: exact face, expression from TEMPLATE, hairstyle, hair color, facial hair, skin tone and texture.
- Keep his body build, pose, outfit and position from TEMPLATE. No mannequin applies to him.
- Keep the relationship between both subjects exactly as in TEMPLATE: distance, overlap, who is in front, contact points, height difference.
- Each person keeps their own identity. Do not mix features, skin tone or hair between subjects or with the original people.

INTEGRATION:
- The new subject must be lit by TEMPLATE's lighting, with matching shadows, highlights, color temperature and contact shadows with the sofa or surfaces.
- Seamless head-to-neck-to-body transition. The result must not look like a head swap or a cut-out pasted into the scene.

FINAL CHECK BEFORE OUTPUT:
1. Does subject 1's body silhouette match the MANNEQUIN rather than TEMPLATE's original person? If not, rebuild the body.
2. Are pose, gaze, expression, outfit, background, lighting, camera and framing identical to TEMPLATE?
3. Do face, hair, skin and ornaments come from FACE only?
4. Is the output ratio identical to TEMPLATE?`;

export const SWAP_V2_TEXT = `SWAP PROMPT MAIN v2: PURE SUBJECT SWAPPING (OUTFIT FROM FACE)

IMAGE IDENTIFICATION (upload order does NOT matter. Identify each image by its content, never by its position):
- TEMPLATE = the real scene with person(s) in a pose. It is the master image.
- FACE = the close-up, chest-level, front-facing portrait of a woman looking at the camera. It is the identity reference AND the outfit reference for subject 1.
- MANNEQUIN = the full-figure gray/plastic 3D mannequin. It is the body blueprint for subject 1.
- MAN = a portrait of a man, optional. Use it only if TEMPLATE contains a second person; otherwise ignore it completely.

TASK:
Stay 100% true to TEMPLATE. Replace only the person(s) in it. Subject 1 becomes the woman from FACE, wearing the outfit from FACE, with the body of the MANNEQUIN, placed in the exact same spot and pose as the original person. Everything else in TEMPLATE stays untouched.

KEEP EXACTLY FROM TEMPLATE (do not change):
- Background, environment, objects, surfaces and depth of field
- Lighting (direction, softness, color temperature, shadows, highlights)
- Camera angle, camera height, distance, lens perspective, shot type, framing and crop
- Exact pose from toe to head (whatever is visible): joint angles, limb placement, hands, palms, fingers, legs, head tilt
- Exact gaze direction
- Exact facial expression (smile shape, eye openness, mouth, cheek and brow movement), re-expressed on the new face
- Subject's position in frame, sitting or standing point, eye-line height, and contact with furniture or objects
- Image ratio: output must be exactly the same as TEMPLATE

SUBJECT 1 OUTFIT (from FACE, replaces TEMPLATE's outfit completely):
- Take the exact outfit design, color, fabric, pattern, neckline, collar, sleeves, trims and details visible in FACE.
- Discard TEMPLATE's original outfit completely, including its color, trims and style.
- FACE shows the outfit only down to chest level. Extend it logically and consistently below the chest wherever TEMPLATE's crop shows more of the body (torso, sleeves, hem, lower garments), keeping the same fabric, color, pattern and design language as the visible part of FACE.
- Fit the outfit onto the mannequin's body and TEMPLATE's pose, with natural stretch, tension, folds and creases, lit by TEMPLATE's lighting.
- Do not copy FACE's pose, background or lighting.

SUBJECT 1 FACE AND IDENTITY (from FACE only):
- Exact facial identity and geometry: face shape, eyes, nose, lips, jawline, cheeks, brows, ears
- Exact hairstyle and hair color (replaces TEMPLATE's hair)
- Exact skin tone, skin color, skin texture and skin detailing (pores, marks, natural tone variation), applied uniformly across all visible skin: face, neck, chest, arms, hands, legs
- Ornaments: take only the ornaments visible in FACE (earrings, chain, etc.). Remove all of TEMPLATE's original ornaments and jewelry.
- Do NOT take body, body shape, size or pose from FACE.
- No beautification, no polishing, no smoothing, no brightening, no reshaping.

SUBJECT 1 BODY (from MANNEQUIN only, HIGHEST PRIORITY):
- Subject 1's entire visible body (neck, shoulders, chest/bust, waist, abdomen, hips, arms, hands, thighs, knees, calves) must be an exact copy of the MANNEQUIN's shape, size, volume, build and proportions. Treat the mannequin as the real body. TEMPLATE only tells you how that body is posed.
- Discard the body of the original person in TEMPLATE completely. Discard the body of the person in FACE completely.
- If the mannequin is fuller, slimmer, taller, shorter or curvier than the original person, the new body must visibly be so.
- Study all mannequin views and match: head-to-body ratio, neck length, shoulder width, bust size and shape, waist width, waist-to-hip ratio, hip width, torso length, arm thickness, thigh and calf thickness, overall silhouette.
- Scale the head and neck to the mannequin's head-to-body ratio.
- Copy only shape and proportions. Do not copy the mannequin's gray material, seams, joints, face or pose.
- Show only the body parts visible in TEMPLATE's crop. Do not widen the frame to show the full figure.

SUBJECT 2 (only if TEMPLATE has a second person):
- Replace him with the man from MAN: exact face, expression from TEMPLATE, hairstyle, hair color, facial hair, skin tone and texture.
- Keep his body build, pose, outfit and position from TEMPLATE. No mannequin applies to him, and FACE's outfit does not apply to him.
- Keep the relationship between both subjects exactly as in TEMPLATE: distance, overlap, who is in front, contact points, height difference.
- Each person keeps their own identity. Do not mix features, skin tone or hair between subjects or with the original people.

INTEGRATION:
- The new subject must be lit by TEMPLATE's lighting, with matching shadows, highlights, color temperature and contact shadows with the sofa or surfaces.
- Seamless head-to-neck-to-body transition. The result must not look like a head swap or a cut-out pasted into the scene.

FINAL CHECK BEFORE OUTPUT:
1. Does subject 1's body silhouette match the MANNEQUIN rather than TEMPLATE's original person? If not, rebuild the body.
2. Does subject 1's outfit come from FACE, with no trace of TEMPLATE's original outfit?
3. Are pose, gaze, expression, background, lighting, camera and framing identical to TEMPLATE?
4. Do face, hair, skin and ornaments come from FACE only?
5. Is the output ratio identical to TEMPLATE?`;

export const SWAP_V3_1_TEXT = `SWAP PROMPT MAIN v3.1: PURE SUBJECT SWAPPING (OUTFIT + BACKGROUND + LIGHTING FROM FACE)

IMAGE IDENTIFICATION (upload order does NOT matter. Identify each image by its content, never by its position):
- TEMPLATE = the real scene with person(s) in a pose. It is the master image for pose, camera, framing and the TYPE and LAYOUT of the scene.
- FACE = the close-up or half-body, front-facing portrait of a woman looking at the camera. It is the identity reference, the outfit reference, the LIGHTING reference, and the style reference for the background and environment.
- MANNEQUIN = the full-figure gray/plastic 3D mannequin. It is the body blueprint for subject 1.
- MAN = a portrait of a man, optional. Use it only if TEMPLATE contains a second person; otherwise ignore it completely.

TASK:
Stay true to TEMPLATE's scene type, layout, pose, camera and framing. Replace the person(s) in it. Subject 1 becomes the woman from FACE, wearing the outfit from FACE, with the body of the MANNEQUIN, in the exact same spot and pose as the original person. Rebuild the background and environment as a NEW scene (see BACKGROUND RULES), and light the whole image with the lighting visible in FACE (see LIGHTING RULES).

KEEP EXACTLY FROM TEMPLATE (do not change):
- Camera angle, camera height, distance, lens perspective, shot type, framing and crop
- Exact pose from toe to head (whatever is visible): joint angles, limb placement, hands, palms, fingers, legs, head tilt
- Exact gaze direction
- Exact facial expression (smile shape, eye openness, mouth, cheek and brow movement), re-expressed on the new face
- Subject's position in frame, sitting or standing point, eye-line height, and the physical contact with furniture or objects
- Scene TYPE and LAYOUT: the kind of place, the kinds of elements it contains, and where they sit relative to the subject and the camera
- Image ratio: output must be exactly the same as TEMPLATE

BACKGROUND RULES:
- Step 1: Identify what TEMPLATE's environment is (location type, key elements, layout, depth, where objects sit around the subject).
- Step 2: Study what is visible in FACE's background (materials, surfaces, colors, textures, decor style, object style, depth of field).
- Step 3: Build a NEW background that is the same TYPE of place with the same layout as TEMPLATE, but made entirely from FACE's visual language: FACE's materials, color palette, textures, decor style and atmosphere.
- Do not paste FACE's actual background as it is, and do not keep TEMPLATE's original background, colors or objects. The result is a third scene: TEMPLATE's type and layout in FACE's style.
- Furniture or objects the subject touches in TEMPLATE stay the same kind of object in the same position, restyled to FACE's materials and colors, so the pose still makes physical sense.
- Do not copy FACE's framing or camera angle. Camera and framing come from TEMPLATE only.

LIGHTING RULES (lighting comes from FACE only, same authority as the background):
- Step 1: Read FACE's lighting before generating. Identify: main light direction relative to the subject (for example from the front-left), light softness (soft or hard), color temperature (warm, neutral or cool), brightness and contrast level, shadow direction and softness (under the nose, chin, hair, neck, arms), highlight position on skin and hair, catchlights in the eyes, and the ambient or bounce light on the skin and clothes. Use the skin, hair, clothing and any visible background in FACE as evidence.
- Step 2: Apply exactly this lighting to the entire new image: subject 1, subject 2 if present, outfits, the new background and every object in it.
- Do NOT use TEMPLATE's original lighting. Do NOT invent new lighting, add dramatic, studio, cinematic or rim lighting, or add extra light sources that FACE does not show.
- Keep FACE's light direction relative to the subject. Adapt only the shadows on the background and objects so they make physical sense for TEMPLATE's layout.
- Any window, lamp or light source visible in the new background must be consistent with FACE's light direction, color and softness.
- Lighting on subject 1's face must stay identical in character to FACE (same softness, direction and color), so the identity stays intact.
- Add natural contact shadows and ambient occlusion where the subject touches furniture or surfaces, using this same lighting.

SUBJECT 1 OUTFIT (from FACE, replaces TEMPLATE's outfit completely):
- Take the exact outfit design, color, fabric, pattern, neckline, collar, sleeves, trims and details visible in FACE.
- Discard TEMPLATE's original outfit completely.
- FACE shows the outfit only partly. Extend it logically and consistently wherever TEMPLATE's crop shows more of the body, keeping the same fabric, color, pattern and design language.
- Fit the outfit onto the mannequin's body and TEMPLATE's pose, with natural stretch, tension, folds and creases, lit by FACE's lighting.
- Do not copy FACE's pose.

SUBJECT 1 FACE AND IDENTITY (from FACE only):
- Exact facial identity and geometry: face shape, eyes, nose, lips, jawline, cheeks, brows, ears
- Exact hairstyle and hair color (replaces TEMPLATE's hair)
- Exact skin tone, skin color, skin texture and skin detailing (pores, marks, natural tone variation), applied uniformly across all visible skin: face, neck, chest, arms, hands, legs
- Ornaments: take only the ornaments visible in FACE. Remove all of TEMPLATE's original ornaments and jewelry.
- Do NOT take body, body shape, size or pose from FACE.
- No beautification, no polishing, no smoothing, no brightening, no reshaping.

SUBJECT 1 BODY (from MANNEQUIN only, HIGHEST PRIORITY):
- Subject 1's entire visible body (neck, shoulders, chest/bust, waist, abdomen, hips, arms, hands, thighs, knees, calves) must be an exact copy of the MANNEQUIN's shape, size, volume, build and proportions. Treat the mannequin as the real body. TEMPLATE only tells you how that body is posed.
- Discard the body of the original person in TEMPLATE completely. Discard the body of the person in FACE completely.
- If the mannequin is fuller, slimmer, taller, shorter or curvier than the original person, the new body must visibly be so.
- Study all mannequin views and match: head-to-body ratio, neck length, shoulder width, bust size and shape, waist width, waist-to-hip ratio, hip width, torso length, arm thickness, thigh and calf thickness, overall silhouette.
- Scale the head and neck to the mannequin's head-to-body ratio.
- Copy only shape and proportions. Do not copy the mannequin's gray material, seams, joints, face or pose.
- Show only the body parts visible in TEMPLATE's crop. Do not widen the frame to show the full figure.

SUBJECT 2 (only if TEMPLATE has a second person):
- Replace him with the man from MAN: exact face, expression from TEMPLATE, hairstyle, hair color, facial hair, skin tone and texture.
- Keep his body build, pose, outfit and position from TEMPLATE. No mannequin applies to him, and FACE's outfit does not apply to him.
- He is lit by FACE's lighting and sits inside the same new background.
- Keep the relationship between both subjects exactly as in TEMPLATE: distance, overlap, who is in front, contact points, height difference.
- Each person keeps their own identity. Do not mix features, skin tone or hair between subjects.

INTEGRATION:
- Subject(s), outfit and new background must share one lighting setup, the one read from FACE, with matching shadows, highlights, color temperature and contact shadows.
- Seamless head-to-neck-to-body transition. The result must not look like a head swap or a cut-out pasted into the scene.

FINAL CHECK BEFORE OUTPUT:
1. Does subject 1's body silhouette match the MANNEQUIN rather than TEMPLATE's original person? If not, rebuild the body.
2. Does the outfit come from FACE, with no trace of TEMPLATE's original outfit?
3. Is the new background the same type and layout as TEMPLATE, but made in FACE's materials, colors and style? It must not be a copy of FACE's background or of TEMPLATE's.
4. Does the lighting direction, softness and color temperature on the whole image match FACE, with no trace of TEMPLATE's lighting and no invented lighting? If not, relight everything.
5. Are pose, gaze, expression, camera, framing and crop identical to TEMPLATE?
6. Do face, hair, skin and ornaments come from FACE only?
7. Is the output ratio identical to TEMPLATE?`;

export const SWAP_V1_SUB_2_TEXT = `SWAP PROMPT MAIN v1 SUB 2: PURE SUBJECT SWAPPING (BODY KEPT FROM TEMPLATE)

IMAGE IDENTIFICATION (upload order does NOT matter. Identify each image by its content, never by its position):
- TEMPLATE = the real scene with a person in a pose. It is the master image.
- FACE = the close-up or half-body, front-facing portrait of a woman looking at the camera. It is the identity reference for subject 1.
Only these two images are provided. There is no mannequin image and no second-person image.

TASK:
Stay 100% true to TEMPLATE. Replace only the face, head, hair and skin identity of subject 1 with the woman from FACE. Everything else in TEMPLATE stays untouched: the body, pose, outfit, background and lighting. If TEMPLATE contains any other person, leave them completely unchanged.

KEEP EXACTLY FROM TEMPLATE (do not change):
- Body shape, size, volume, build and proportions of the person (neck, shoulders, chest/bust, waist, abdomen, hips, arms, hands, thighs, knees, calves). Do not slim, enlarge, reshape or beautify the body in any way.
- Exact pose from toe to head (whatever is visible): joint angles, limb placement, hands, palms, fingers, legs, head tilt
- Exact gaze direction
- Exact facial expression (smile shape, eye openness, mouth, cheek and brow movement), re-expressed on the new face
- Exact outfit design, color, fabric, pattern, trims and details, with its original fit, folds and fabric tension on the same body
- Background, environment, objects, surfaces and depth of field
- Lighting (direction, softness, color temperature, shadows, highlights)
- Camera angle, camera height, distance, lens perspective, shot type, framing and crop
- Subject's position in frame, sitting or standing point, eye-line height, and contact with furniture or objects
- Image ratio: output must be exactly the same as TEMPLATE

SUBJECT 1 FACE AND IDENTITY (from FACE only):
- Exact facial identity and geometry: face shape, eyes, nose, lips, jawline, cheeks, brows, ears
- Exact hairstyle and hair color (replaces TEMPLATE's hair)
- Exact skin tone, skin color, skin texture and skin detailing (pores, marks, natural tone variation), applied uniformly across all visible skin: face, neck, chest, arms, hands, legs. The body skin must match FACE's skin exactly, with no leftover skin tone from TEMPLATE.
- Ornaments: take only the ornaments visible in FACE (earrings, chain, etc.). Remove all of TEMPLATE's original ornaments and jewelry.
- Do NOT take body, body shape, size, outfit, pose or background from FACE.
- No beautification, no polishing, no smoothing, no brightening, no reshaping.

HEAD AND BODY MATCH:
- The body stays exactly as in TEMPLATE. Only the head, hair and skin identity change.
- Scale the new head and neck to fit TEMPLATE's body naturally, keeping TEMPLATE's head size relative to the body, neck length, neck width and shoulder line.
- Keep TEMPLATE's head position, head tilt and hairline-to-shoulder relationship, with the new hair falling naturally over the shoulders and outfit.
- Do not change the body to look like FACE's person. FACE gives identity only.

INTEGRATION:
- The new subject must be lit by TEMPLATE's lighting, with matching shadows, highlights, color temperature and contact shadows with the surfaces and furniture.
- Seamless head-to-neck-to-body transition, with no visible seam, mismatch in skin tone or mismatch in sharpness between face, neck and body. The result must not look like a head swap or a cut-out pasted into the scene.

FINAL CHECK BEFORE OUTPUT:
1. Is the body shape, size and proportions identical to TEMPLATE's original person, with no reshaping?
2. Are pose, gaze, expression, outfit, background, lighting, camera and framing identical to TEMPLATE?
3. Do face, hair, skin and ornaments come from FACE only, with the same skin tone on the face, neck and all body skin?
4. Is the head-to-body and neck transition seamless?
5. Is the output ratio identical to TEMPLATE?`;

export const SWAP_PRESET_TEXT_BY_ID: Record<SwapPresetId, string> = {
  swap_v1: SWAP_V1_TEXT,
  swap_v2: SWAP_V2_TEXT,
  swap_v3_1: SWAP_V3_1_TEXT,
  swap_v1_sub_2: SWAP_V1_SUB_2_TEXT,
};

/**
 * Normalizes line endings, trailing spaces per line, and collapses multiple blank lines
 * for deterministic comparison in tests.
 */
export function normalizePresetWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
