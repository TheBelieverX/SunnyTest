# Session Context & Image Consistency Feature

## Overview

The image generation system now remembers what was discussed throughout the session and maintains visual consistency across all generated images. If a character has blue hair in the first image, they will have blue hair in all subsequent images—unless you explicitly mention a change.

## How It Works

### 1. **Session History Tracking**
- Every time an image is generated, the text used for that image is added to the session history
- The system keeps the last 3 pieces of generated text as context
- This history is passed to Gemini for each new image generation

### 2. **Attribute Extraction**
The system automatically extracts and remembers:
- **Physical attributes**: Hair color, eye color, clothing (dress, cloak, etc.)
- **Character roles**: Prince, princess, king, queen, etc.
- **Settings**: Castle, forest, palace, tower, etc.
- **Tone/Style**: Magical, enchanted, fantastical elements

Examples of detected attributes:
- "blue hair" → remembered for future images
- "red dress" → maintained across images
- "golden castle" → consistent setting
- "magical forest" → maintained atmosphere

### 3. **Consistency Instructions**
When generating each new image, the system instructs Gemini to:
- Maintain the same appearance for characters that appeared before
- Keep the setting/background consistent with previously described locations
- Only change details if the description explicitly mentions a change
- Preserve the magical/fantastical tone throughout the story

## Example Usage

### Session Flow:

**Image 1** (First 70 words):
> "Once upon a time, there lived a young princess with flowing blue hair in a golden castle..."
- ✅ Princess with blue hair established
- ✅ Golden castle setting established

**Image 2** (Next 70 words):
> "The princess walked through the enchanted gardens near her castle..."
- ✅ System remembers: blue-haired princess
- ✅ System remembers: golden castle
- ✅ Generated image shows consistent character and setting

**Image 3** (Next 70 words):
> "She met a kind wizard in the forest..."
- ✅ Wizard is new character (no previous context)
- ✅ Princess still has blue hair (maintained)
- ✅ Forest now added to scene context

**Image 4** (If you mention a change):
> "The princess decided to change her hair color to silver..."
- ✅ Explicitly mentions change
- ✅ New images will show silver hair
- ✅ Only this attribute is updated

## Technical Implementation

### Modified Files

#### 1. `services/bufferManager.ts`
**New properties:**
- `sessionHistory`: Stores text from each generation
- `establishedAttributes`: Tracks extracted attributes

**New methods:**
- `extractAttributes()`: Finds and stores key attributes from text
- `buildSessionContext()`: Creates context string for Gemini
- Stores `sessionContext` in `GenerationRequest`

**Enhanced `reset()`**: Clears session history when starting new session

#### 2. `services/geminiService.ts`
**Updated function signature:**
```typescript
export async function generateIllustration(
  description: string, 
  sessionContext?: string  // NEW: session history parameter
): Promise<string>
```

**Enhanced prompt:**
- Includes session context in Gemini instructions
- Adds consistency directives
- Instructs model to maintain established attributes

#### 3. `App.tsx`
**Updated generation call:**
```typescript
const imageUrl = await generateIllustration(
  request.sourceText, 
  request.sessionContext  // NEW: pass context
);
```

### Data Flow

```
User speaks → Text transcribed → Buffer accumulates → 70 words reached
    ↓
Extract attributes from text → Add to sessionHistory
    ↓
Build sessionContext from history
    ↓
GenerationRequest (includes sessionContext)
    ↓
generateIllustration(description, sessionContext)
    ↓
Gemini generates image WITH consistency instructions
    ↓
Image displayed (consistent with previous images)
```

## Features

### ✅ Automatic Attribute Detection
Patterns for:
- Hair, eyes, dress, cloak
- Character roles (prince, princess, king)
- Settings (castle, forest, palace)
- Tone (magical, enchanted)

### ✅ Expandable Patterns
Easy to add more attribute patterns in `extractAttributes()` method

### ✅ Context Memory
- Keeps last 3 pieces of text for context
- Stores up to 10 most recent attributes
- Prevents context from becoming too long/overwhelming

### ✅ Explicit Change Support
If you mention "the princess dyes her hair" or "the castle is now silver", Gemini will understand and update accordingly

### ✅ Session Isolation
Starting a new session clears all history—each session is independent

## Example Attributes Tracked

### Physical Attributes
- "blue hair" ✅
- "golden eyes" ✅
- "red dress" ✅
- "silver cloak" ✅
- "green cape" ✅

### Character Types
- "Prince" / "Prinț" ✅
- "Princess" / "Prințesă" ✅
- "King" / "Rege" ✅
- "Queen" / "Regină" ✅

### Settings
- "Castle" / "Castel" ✅
- "Forest" / "Pădure" ✅
- "Tower" / "Turn" ✅
- "Palace" / "Palat" ✅
- "Woods" ✅

### Tone
- "Magical" / "Vrăji" ✅
- "Enchanted" ✅
- "Mysterious" ✅
- "Whimsical" ✅

## Debugging

### View Session Context
The session context appears in:
- Browser console (F12) - shows extracted attributes
- Generation logs - shows what context was used

### Test Consistency
Try this test story:
1. First segment: Describe a character with specific appearance
2. Second segment: Mention the character again without describing them
3. Compare images - the character should look the same

## Limitations & Notes

1. **Gemini's Interpretation**: While we provide context, Gemini's generation is still probabilistic. Some variation may occur with complex attributes.

2. **Attribute Extraction**: The pattern matching is rule-based. Very unusual descriptions might not be extracted.

3. **Context Length**: We keep last 3 texts + 10 attributes to avoid overwhelming the prompt. Very long stories might need manual mention of key attributes.

4. **Language**: Currently optimized for English and Romanian patterns.

## Future Enhancements

Possible improvements:
- Store character details explicitly (name, appearance, role)
- Visual consistency scoring
- Automatic re-generation if consistency breaks
- User-defined style guide persistence
- Character sheet generation from session
- Auto-detection of character names and tracking them

## Testing the Feature

**Simple Test:**
```
Session 1:
- Speak: "A princess with red hair sat in her blue palace"
- See: Princess with red hair in blue palace
- Speak: "She walked in the garden near the palace"
- See: Same princess, same palace (consistency maintained!)

Session 2:
- All history is cleared
- Start fresh story
```

**Advanced Test:**
```
- Describe character: "handsome prince with dark hair"
- Generate first image
- Speak more without mentioning hair
- Generate second image (dark hair maintained)
- Explicitly say: "his hair turned white"
- Generate third image (white hair now)
```

---

## Summary

Your Povești Magice app now creates visually consistent children's book illustrations throughout a session. Each image builds on the established story context, creating a cohesive narrative experience where characters and settings remain visually consistent unless explicitly changed.

This makes the generated book feel like a real illustrated story rather than disconnected images! ✨📚
