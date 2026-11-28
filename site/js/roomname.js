// Room names that a relay server cannot guess. Without a password the room name is the key of a
// multiplayer room (netcrypt.js): whoever guesses it can put itself in between. A random name
// of four words and a number ("amber-otter-cloud-river-42") has about 38 bits: with 600,000
// PBKDF2 rounds per guess that is months of work for a graphics card, and it can still be read
// out on the phone.

// 256 short, common English words (8 bits each).
const WORDS = (
  'acorn amber anchor apple arrow aspen atlas autumn bamboo banjo barley basil beacon bean '
  + 'berry birch bison blaze bloom bluff bolt bonsai boulder brass breeze brick brook bubble '
  + 'buffalo cactus camel candle canoe canyon cargo carrot castle cedar cello cherry chess '
  + 'cider cinder citrus clover cobalt cocoa comet copper coral cosmos cotton crane crater '
  + 'cricket crystal cypress daisy delta desert dingo dolphin dragon drum dune eagle ember '
  + 'falcon fern fiddle fig finch fjord flame flint forest fossil fox frost galaxy garnet '
  + 'gecko geyser ginger glacier globe goose granite grape gravel guitar harbor hazel heron '
  + 'hickory honey hornet husky iceberg igloo indigo iris island ivory jade jaguar jasmine '
  + 'jelly jungle kayak kelp kettle kiwi koala lagoon lantern lark lava lemon lilac lily lime '
  + 'linen lizard llama lobster lotus lynx magnet mango maple marble meadow melon mesa meteor '
  + 'mint mist moose mosaic moss mule nectar nebula nickel nutmeg oak oasis ocean olive onyx '
  + 'opal orbit orca orchid otter owl oyster panda papaya parrot peach pebble pecan pelican '
  + 'pepper pine pirate pixel plasma plum polar pony poppy prism puffin pumpkin quail quartz '
  + 'quill rabbit radar raven reef rhino ribbon ripple river robin rocket rover ruby saffron '
  + 'sage salmon sandal sapphire satin scarab sequoia shadow shell sierra silver sketch sloth '
  + 'smoke snail sonnet spark sparrow spice sprout squid stone storm sugar summit sunset swan '
  + 'tango teapot thistle thunder tiger timber toffee topaz torch toucan tulip tundra turtle '
  + 'umber valley velvet violet volcano walnut walrus wander wasabi willow winter wizard wolf '
  + 'yak yarrow yeti yoyo zebra zenith zephyr zinc cloud pearl'
).split(' ');

/** A random room name like "amber-otter-cloud-river-42" (at most 32 characters). */
export function randomRoomName() {
  for (;;) {
    const r = crypto.getRandomValues(new Uint8Array(5));
    const name = `${[...r.subarray(0, 4)].map((b) => WORDS[b]).join('-')}-${10 + (r[4] % 90)}`;
    if (name.length <= 32) return name;
  }
}

/**
 * Rough guess how hard a room name is to guess, in bits. A generated name counts its full 38
 * bits. In typed names a word counts like one of a few thousand common words (at most 11 bits),
 * a number 3.3 bits per digit, a jumble of letters and digits by its characters.
 */
export function nameStrength(name) {
  const parts = name.trim().toLowerCase().split('-');
  if (parts.length === 5 && parts.slice(0, 4).every((w) => WORDS.includes(w)) && /^\d{2}$/.test(parts[4])) return 38;
  let bits = 0;
  for (const token of name.trim().split(/[\s\-_.,]+/).filter(Boolean)) {
    if (/^\p{L}+$/u.test(token)) bits += Math.min(11, token.length * 2.3);
    else if (/^\d+$/.test(token)) bits += token.length * 3.3;
    else {
      let pool = 0;
      if (/[a-z]/.test(token)) pool += 26;
      if (/[A-Z]/.test(token)) pool += 26;
      if (/\d/.test(token)) pool += 10;
      if (/[^a-zA-Z\d]/.test(token)) pool += 20;
      bits += token.length * Math.log2(pool || 2);
    }
  }
  return Math.round(bits);
}

/** Below this, a room without a password gets a warning. */
export const STRONG_NAME_BITS = 36;

export const ROOM_WORDS = WORDS;
