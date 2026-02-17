import { type } from "arktype";
const Choice = type({
  text: "string",
  "next?": "string",
  "effect?": "string | string[]",
  "cond?": "string | string[]",
});
const Decision = type({
  input: Choice.array(),
});
const Line = type.or(
  "string",
  type({
    "delay?": "number",
    "text?": "string",
    "trigger?": "string",
  }),
);
const Dialogue = type({
  char: "string",
  "delay?": "number",
  "unskippable?": "boolean",
  "randomize?": "boolean",
  text: type.or(Line, Line.array()),
  "trigger?": "string",
  "next?": "string",
});

const Node = type.or(Decision, Dialogue);
const Encounter = type({
  "[string]": Node,
});

export const lines = {
  intro: {
    input: [
      {
        text: "(Equip space helmet.)",
        trigger: "HELMET",
      },
    ],
  },
  begin: {
    char: "DRAGON",
    text: ["This so-called “uncle” had better be good."],
    next: "player_0",
  },
  player_0: {
    input: [
      {
        text: "He’s the best in the galaxy.",
        next: "dragon_1",
      },
      {
        text: "Or what?",
        next: "dragon_2",
      },
      {
        text: "(Stay silent.)",
        next: "dragon_3",
        effect: "set('dragon_sarcasm', false)",
      },
    ],
  },
  dragon_1: {
    char: "DRAGON",
    text: ["A bold claim. We shall see."],
    next: "dragon_3",
  },
  dragon_2: {
    char: "DRAGON",
    text: ["Tread lightly, human."],
    next: "dragon_3",
  },
  dragon_3: {
    char: "DRAGON",
    delay: 2.0,
    text: ["Describe uncle’s lair to me once more."],
    next: "player_1",
  },
  player_1: {
    input: [
      {
        text: "Well, it’s a bar on an asteroid.",
        next: "dragon_4",
      },
      {
        text: "He says it’s a hive of scum and villainy.",
        next: "dragon_5",
      },
      {
        text: "(Stay silent.)",
        next: "dragon_6",
      },
    ],
  },
  dragon_4: {
    char: "DRAGON",
    text: ["Ah, asteroids. The caves of space. Fitting."],
    next: "dragon_8",
  },
  dragon_5: {
    char: "DRAGON",
    text: ["You consider humans to be villainous? Amusing."],
    next: "dragon_8",
  },
  dragon_6: {
    char: "DRAGON",
    text: ["DON’T make me turn around."],
    next: "player_2",
  },
  player_2: {
    input: [
      {
        text: "(Stay silent.)",
        next: "dragon_7",
        cond: "!dragon_sarcasm",
      },
      {
        text: "(Stay silent.)",
        next: "dragon_7_sarcasm",
        cond: "dragon_sarcasm",
      },
    ],
  },
  dragon_7_sarcasm: {
    char: "DRAGON",
    text: ["I forgot humans can’t speak in space. Sorry."],
    next: "dragon_8",
  },
  dragon_7: {
    char: "DRAGON",
    text: ["I forgot humans can’t speak in space. Sorry."],
    next: "dragon_8",
  },
  dragon_8: {
    char: "DRAGON",
    delay: 4.0,
    text: [
      { text: "We’ve arrived.", trigger: "ARRIVE_AT_BAR" },
      "Make haste, lest you become dinner.",
    ],
  },
  bouncer_start: {
    char: "BOUNCER",
    text: ["Oi. Gonna need to see some ID."],
    next: "player_3",
  },
  player_3: {
    input: [
      {
        text: "(Wave hand) You don’t need to see my ID.",
        next: "bouncer_1",
        once: true,
      },
      {
        text: "(Deception) Ah, shoot, I think I left it on my dragon...",
        next: "bouncer_2",
        once: true,
      },
      {
        text: "Don’t have it. I just got out of jail.",
        next: "bouncer_3",
        effect: "set('talked_to_bouncer', true)",
      },
    ],
  },
  bouncer_1: {
    char: "BOUNCER",
    text: ["Yeah. I do."],
    next: "player_3",
  },
  bouncer_2: {
    char: "BOUNCER",
    text: ["Lying won’t help you here, buddy."],
    next: "player_3",
  },
  bouncer_3: {
    char: "BOUNCER",
    text: ["Impossible. Nobody’s ever busted out of Spacerock Prison before."],
    next: "player_4",
  },
  player_4: {
    input: [
      {
        text: "I’m just built different.",
        next: "bouncer_4",
        once: true,
      },
      {
        text: "Oh, uh, it’s another prison. You don’t know it.",
        next: "bouncer_7",
      },
      {
        text: "You should let me in. My uncle owns this place...",
        next: "bouncer_5",
      },
    ],
  },
  bouncer_4: {
    char: "BOUNCER",
    text: ["The answer’s no. Out!"],
    next: "player_4",
  },
  bouncer_5: {
    char: "BOUNCER",
    text: ["And my uncle owns a bakery on the Outer Rim. So what?"],
    next: "player_5",
  },
  player_5: {
    input: [
      {
        text: "I need to talk to him. It’s urgent.",
        next: "bouncer_6",
      },
      {
        text: "I could give you these crystals I found in prison...",
        next: "bouncer_6",
      },
    ],
  },
  bouncer_6: {
    char: "BOUNCER",
    text: [
      "You know what, fine. You're cleared for passage.",
      "Whatever makes you leave me alone.",
    ],
  },
  bouncer_7: {
    char: "BOUNCER",
    text: ["Try me. Orion Prison? Solar Prison? Bunny Prison?"],
    next: "player_6",
  },
  player_6: {
    input: [
      {
        text: "Orion Prison!",
        next: "bouncer_8",
      },
      {
        text: "Solar Prison!",
        next: "bouncer_8",
      },
      {
        text: "Bunny Prison!",
        next: "bouncer_8",
      },
    ],
  },
  bouncer_8: {
    char: "BOUNCER",
    text: [
      "Right on! I had a cousin do some time in that prison.",
      "Come on in, I think you’ll fit in fine ‘round here.",
    ],
  },
  bouncer_again: {
    char: "BOUNCER",
    text: ["You again? What?"],
    next: "player_7",
  },
  player_7: {
    input: [
      {
        text: "I need to earn some tickets.",
        cond: "knows_about_tickets && !beat_bouncer",
        next: "bouncer_10",
      },
      {
        text: "Quick rematch?",
        cond: "beat_bouncer",
        next: "bouncer_15",
        once: true,
      },
      {
        text: "Nothing, nevermind.",
        next: "bouncer_mhm",
      },
    ],
  },
  bouncer_mhm: {
    char: "BOUNCER",
    text: ["Mmmhm."],
  },
  bouncer_10: {
    char: "BOUNCER",
    text: [
      "Well you should probably look somewhere else.",
      "The only thing I give tickets out for is a good old-fashioned arm wrestle.",
    ],
    next: "player_8",
  },
  player_8: {
    input: [
      {
        text: "You’re on.",
        next: "bouncer_11",
      },
      {
        text: "Screw that!",
        next: "bouncer_12",
      },
    ],
  },
  bouncer_11: {
    char: "BOUNCER",
    text: [
      "You’re dumber than you look.",
      "Fine, which arm do you want me to break?",
    ],
    trigger: "ARM_WRESTLE",
  },
  bouncer_12: {
    char: "BOUNCER",
    text: ["Smart."],
  },
  bouncer_13: {
    char: "BOUNCER",
    text: ["I can do this all day. Wanna go again?"],
    next: "player_rematch",
  },
  player_rematch: {
    input: [
      {
        text: "Let's go.",
        trigger: "ARM_WRESTLE",
      },
      {
        text: "I'm tapping out.",
        next: "bouncer_12",
        trigger: "ARM_WRESTLE_GIVE_UP",
      },
    ],
  },
  bouncer_rematch: {
    char: "BOUNCER",
    text: ["Lookin' for a rematch?"],
    next: "player_8",
  },
  bouncer_14: {
    char: "BOUNCER",
    text: [
      "Impossible! You must have cheated!",
      "Whatever, take your stupid ticket.",
    ],
  },
  bouncer_15: {
    char: "BOUNCER",
    text: ["You already beat me, what more do you want?"],
  },
  janitor_0: {
    char: "JANITOR",
    text: [
      "Woah, hey, sorry, bathroom’s closed.",
      "Someone did some real work in there.",
      { trigger: "CLOSE_RESTROOM_DOOR" },
      { text: "Alright you ostentatious obstruction, take this!" },
      "PLAAAAASMAAA BALLLLLLLL!",
    ],
  },
  dragon_guy_0: {
    char: "DRAGON_GUY",
    text: ["Are you the guy that rode in on that dragon?!"],
    next: "player_9",
  },
  player_9: {
    input: [
      {
        text: "That’s me.",
        next: "dragon_guy_1",
      },
      {
        text: "I don’t know what you’re talking about.",
        next: "dragon_guy_2",
      },
    ],
  },
  dragon_guy_1: {
    char: "DRAGON_GUY",
    text: [
      "That’s so cool! I love dragons. Almost as much as I love arcade games.",
    ],
    next: "player_10",
    cond: "knows_about_tickets",
  },
  dragon_guy_2: {
    char: "DRAGON_GUY",
    text: ["Aw. I could have sworn it was you... oh well."],
    next: "player_10",
    cond: "knows_about_tickets",
  },
  dragon_guy_3: {
    char: "DRAGON_GUY",
    text: ["Oh, it’s you again! What’s up?"],
    next: "player_10",
  },
  player_10: {
    input: [
      {
        text: "Do these games give tickets?",
        next: "dragon_guy_4",
        cond: "knows_about_tickets && !accepted_wager",
        effect: "set('accepted_wager', true)",
      },
      {
        text: "Nothing, nevermind.",
        cond: "from == 'dragon_guy_3'",
      },
      {
        text: "Sorry to disappoint.",
        cond: "from == 'dragon_guy_2'",
      },
      {
        text: "Nice. Cya around.",
        cond: "from == 'dragon_guy_1'",
      },
    ],
  },
  dragon_guy_4: {
    char: "DRAGON_GUY",
    text: [
      "Sadly, no. But I’d be willing to make a friendly wager...",
      "If you can beat my score on *any* of these games, I’ll give you one of my tickets.",
    ],
    next: "player_11",
  },
  player_11: {
    input: [
      {
        text: "You’re on.",
        next: "dragon_guy_5",
      },
      {
        text: "I already beat one.",
        next: "dragon_guy_6",
        cond: "arcade_wins == 1",
        effect: ["set('beat_dragon_guy', true)", "set('tickets', tickets + 1)"],
      },
      {
        text: "I already beat two of them.",
        next: "dragon_guy_7",
        cond: "arcade_wins == 2",
        effect: ["set('beat_dragon_guy', true)", "set('tickets', tickets + 1)"],
      },
      {
        text: "I already beat all of them.",
        next: "dragon_guy_8",
        cond: "arcade_wins == 3",
        effect: ["set('beat_dragon_guy', true)", "set('tickets', tickets + 1)"],
      },
    ],
  },
  dragon_guy_5: {
    char: "DRAGON_GUY",
    text: ["Pffft, good luck! You’re gonna need it!"],
  },
  dragon_guy_6: {
    char: "DRAGON_GUY",
    text: [
      "What?! Well, I guess that’s on me. I set the bar too low.",
      "Here’s your ticket I guess.",
    ],
  },
  dragon_guy_7: {
    char: "DRAGON_GUY",
    text: [
      "How the-?! At least I still have my dignity...",
      "Here’s your ticket, as promised.",
    ],
  },
  dragon_guy_8: {
    char: "DRAGON_GUY",
    text: [
      "I-I... wha... but that took me months...",
      "Just take the ticket and leave me alone. *sniff*",
    ],
  },
  dragon_guy_9: {
    char: "DRAGON_GUY",
    text: ["What do you want? You already beat me. You don’t have to brag..."],
  },
  dragon_guy_10: {
    char: "DRAGON_GUY",
    text: ["You’re back! Give up yet?"],
    next: "player_12",
  },
  player_12: {
    input: [
      {
        text: "Still working on it.",
      },
      {
        text: "I beat one.",
        next: "dragon_guy_6",
        cond: "arcade_wins == 1",
        effect: ["set('beat_dragon_guy', true)", "set('tickets', tickets + 1)"],
      },
      {
        text: "I beat two of them.",
        next: "dragon_guy_7",
        cond: "arcade_wins == 2",
        effect: ["set('beat_dragon_guy', true)", "set('tickets', tickets + 1)"],
      },
      {
        text: "I beat all of them.",
        next: "dragon_guy_8",
        cond: "arcade_wins == 3",
        effect: ["set('beat_dragon_guy', true)", "set('tickets', tickets + 1)"],
      },
    ],
  },
  bartender_0: {
    char: "BARTENDER",
    text: ["Hiya, welcome to SpaceBusters! What can I get for ya?"],
    next: "player_13",
  },
  bartender_1: {
    char: "BARTENDER",
    text: ["Welcome back, what do you need from me?"],
    next: "player_13",
  },
  player_13: {
    input: [
      {
        text: "I’m looking for my Uncle, Zax.",
        cond: "!talked_to_zax && !tmp_disabled_13_0",
        effect: "set_temp('tmp_disabled_13_0', true)",
        next: "bartender_2",
      },
      {
        text: "Can I get a drink?",
        once: true,
        next: "bartender_3",
      },
      {
        text: "What is this place?",
        cond: "!tmp_disabled_13_1",
        effect: "set_temp('tmp_disabled_13_1', true)",
        next: "bartender_4",
      },
      {
        text: "Is that a prize cabinet?",
        cond: "last_input == 'player_13.2'",
        next: "bartender_5",
        effect: "set('knows_about_tickets', true)",
      },
      {
        text: "Can you give me some tickets?",
        cond: "knows_about_tickets && !bally_cup",
        next: "bartender_6",
      },
      {
        text: "I’d like to redeem a prize.",
        cond: "tickets > 0",
        next: "bartender_14",
      },
      {
        text: "Nevermind for now.",
      },
    ],
  },
  bartender_2: {
    char: "BARTENDER",
    text: [
      "Zax has a nephew? Huh, I had no idea!",
      "He’s just over there, in the back of the bar.",
    ],
    next: "player_13",
  },
  bartender_3: {
    char: "BARTENDER",
    text: ["Absolutely!", "Just need to see your ID for a sec."],
    next: "player_14",
  },
  player_14: {
    input: [
      {
        text: "...Nevermind.",
        next: "player_13",
      },
    ],
  },
  bartender_4: {
    char: "BARTENDER",
    text: [
      "We like to think of this establishment as a safe-haven for all types of folks.",
      "We don’t judge our customers by their past... or their criminal records.",
    ],
    next: "player_13",
  },
  bartender_5: {
    char: "BARTENDER",
    text: [
      "It sure is!",
      "If you win some tickets, you can bring them back to me to redeem a prize!",
    ],
    next: "player_13",
  },
  bartender_6: {
    char: "BARTENDER",
    text: [
      "Well, technically... no....",
      "It’s our policy that tickets need to be won. I can’t just hand them out.",
    ],
    next: "player_15",
  },
  player_15: {
    input: [
      {
        text: "Pleeeeeeeease?",
        next: "bartender_7",
      },
      {
        text: "Understandable.",
      },
    ],
  },
  bartender_7: {
    char: "BARTENDER",
    text: [
      "Weeeelllll, okay, maybe I can help you out.",
      "I have this game called, ummm...",
      "Bally bally cup cup! and if you win, I’ll give you a ticket! Sound good?",
    ],
    next: "player_16",
  },
  player_16: {
    input: [
      {
        text: "Yay! How do I play?",
        effect: "set('bally_cup', true)",
        next: "bartender_9",
      },
      {
        text: "Nah.",
        next: "bartender_8",
      },
      {
        text: "(Stay silent.)",
        effect: "set('bally_cup', true)",
        next: "bartender_9",
      },
    ],
  },
  bartender_8: {
    char: "BARTENDER",
    text: ["Well, you can’t say I didn’t try to help!"],
  },
  bartender_9: {
    char: "BARTENDER",
    text: [
      "Okay! All you have to do, is throw this ball into that cup.",
      "If it goes in, you win!",
    ],
  },
  bartender_10: {
    char: "BARTENDER",
    randomize: true,
    text: [
      "Not quite!",
      "Try again!",
      "Not quite!",
      "Oh...",
      "You can do it!",
      "Soooo close!",
      "Soo close!",
      "Almost!",
      "Unlucky!",
      "Keep trying!",
      "This next one for sure",
      "Ooooooh",
      "Hmmmmm",
      "Darn it!",
    ],
  },
  bartender_13: {
    char: "BARTENDER",
    text: [
      "Oh my gosh! You did it!! We have a winner!!!!",
      "Here you go! One ticket. Congratulations!",
    ],
  },
  bartender_14: {
    char: "BARTENDER",
    text: ["Absolutely! Which prize would you like?"],
    next: "player_18",
  },
  player_18: {
    input: [
      {
        text: "Paperclip. (1 ticket)",
        always: true,
        cond: "tickets >= 1 && !has_paperclip",
        effect: ["set('tickets', tickets - 1)", "set('has_paperclip', true)"],
        next: "bartender_15",
      },
      {
        text: "Space drugs. (2 tickets)",
        always: true,
        cond: "tickets >= 2 && !has_space_drugs",
        effect: ["set('tickets', tickets - 2)", "set('has_space_drugs', true)"],
        next: "bartender_15",
      },
      {
        text: "Neural sticky hand. (3 tickets)",
        always: true,
        cond: "tickets >= 3 && !has_sticky_hand",
        effect: ["set('tickets', tickets - 3)", "set('has_sticky_hand', true)"],
        next: "bartender_15",
      },
      {
        text: "Nothing right now.",
      },
    ],
  },
  bartender_15: {
    char: "BARTENDER",
    text: ["You have great taste!"],
  },
  uncle_zax_0: {
    char: "UNCLE",
    text: [
      "...And so I says, “There’s no such thing as a fiscal year in space”",
      "Oh, shit, what do you want?",
    ],
    next: "player_19",
  },
  player_19: {
    input: [
      {
        text: "Well, uh, so, there’s this dragon...",
        next: "uncle_0",
      },
      {
        text: "You’re my uncle.",
        next: "uncle_1",
        once: true,
      },
      {
        text: "(Stay silent.)",
        next: "uncle_2",
      },
    ],
  },
  uncle_0: {
    char: "UNCLE",
    text: ["Oh don’t worry, dragons can’t come in here. We got a sign!"],
    next: "player_20",
  },
  uncle_1: {
    char: "UNCLE",
    text: ["Uh, yeah, I know. But why are you here? In my bar? In space?"],
    next: "player_19",
  },
  uncle_2: {
    char: "UNCLE",
    text: [
      "You okay there, nephew? You look like you just saw a dragon or somethin’.",
    ],
    next: "player_20",
  },
  player_20: {
    input: [
      {
        text: "I need tax advice. It can’t wait.",
        next: "uncle_3",
      },
      {
        text: "Is this a bar-cade for criminals?",
        effect: "set('player_20_fork', 'b')",
        next: "uncle_3",
      },
    ],
  },
  uncle_3: {
    char: "UNCLE",
    text: [
      "You workin’ with the cops?",
      "I don’t know nothin’ about tax fraud. Especially not SPACE TAX FRAUD.",
    ],
    next: "player_21",
  },
  player_21: {
    input: [
      {
        text: "If I was a cop, I’d have to tell you.",
        next: "uncle_4",
      },
      {
        text: "I didn’t even mention taxes.",
        next: "uncle_4",
        cond: "player_20_fork == 'b'",
      },
      {
        text: "No.",
        next: "uncle_4",
        cond: "player_20_fork == 'a'",
      },
    ],
  },
  uncle_4: {
    char: "UNCLE",
    text: [
      "Yeah yeah yeah. Okay, Tell you what; redeem somethin’ from the prize cabinet over at the bar so I know you’re.. “cool”.",
    ],
    next: "player_22",
  },
  player_22: {
    input: [
      {
        text: "I already have this paperclip.",
        next: "uncle_6",
        cond: "!talked_to_zax && has_paperclip",
      },
      {
        text: "I already have these space drugs.",
        next: "uncle_7",
        cond: "!talked_to_zax && has_space_drugs",
      },
      {
        text: "I already have this sticky hand thing.",
        next: "uncle_8",
        cond: "!talked_to_zax && has_sticky_hand",
      },
      {
        text: "I got the paperclip.",
        next: "uncle_6",
        cond: "talked_to_zax && has_paperclip",
      },
      {
        text: "I got these space drugs.",
        next: "uncle_7",
        cond: "talked_to_zax && has_space_drugs",
      },
      {
        text: "I got this sticky hand thing.",
        next: "uncle_8",
        cond: "talked_to_zax && has_sticky_hand",
      },
      {
        text: "(use the neural sticky hand)",
        next: "uncle_9",
        cond: "has_sticky_hand",
      },
      {
        text: "I’ll be back.",
        effect: [
          "set('talked_to_zax', true)",
          "set('knows_about_tickets', true)",
        ],
      },
    ],
  },
  uncle_5: {
    char: "UNCLE",
    text: ["Hey kid. You got that uhhh, “proof” yet?"],
    next: "player_22",
  },
  uncle_6: {
    char: "UNCLE",
    text: [
      "I mean, I guess that’s *technically* contraband in space.",
      "Alright, whaddya want?",
    ],
    next: "player_23",
  },
  uncle_7: {
    char: "UNCLE",
    text: [
      "Oh good! You picked up my prescription! Thank you so much.",
      "O-o-oh... Alright, whaddya want? Money? Taxes? Girlfriend? Work with me, work with me.",
    ],
    next: "player_23_b",
  },
  uncle_8: {
    char: "UNCLE",
    text: [
      "I’m not sure I even want to know what you’re planning with that.",
      "But, alright, how can I help?",
    ],
    next: "player_23",
  },
  uncle_9: {
    char: "UNCLE",
    text: ["Aggh! What the-! Hello, “nephew”. What services do you require?"],
    next: "player_23_c",
  },
  player_23: {
    input: [
      {
        text: "I told a dragon you could help with tax evasion.",
        next: "uncle_dragon",
      },
      {
        text: "Do you know anything about hoard tax?",
        next: "uncle_hoard_tax",
      },
    ],
  },
  player_23_b: {
    input: [
      {
        text: "Okay, so, hoard tax...",
        next: "uncle_say_no_more",
      },
      {
        text: "I met this dragon...",
        next: "uncle_say_no_more",
      },
    ],
  },
  player_23_c: {
    input: [
      {
        text: "I told a dragon you could help with tax evasion.",
        next: "uncle_11",
      },
      {
        text: "Do you know anything about hoard tax?",
        next: "uncle_11",
      },
    ],
  },
  uncle_say_no_more: {
    char: "UNCLE",
    text: [
      "Say no more! I know exactly why you're here, alrighty let's go.",
      "Sorry gang, duty calls. Throw another round on my- oh, god dammit.",
      "Space drugs, they really go through your system real fast.",
      "Throw another round on my tab.",
    ],
    next: "uncle_pre_musical",
  },
  uncle_11: {
    char: "UNCLE",
    text: ["Absolutely. I will assist you at once."],
    next: "uncle_12",
  },
  uncle_hoard_tax: {
    char: "UNCLE",
    text: ["Hoard tax?!"],
    next: "uncle_12",
  },
  uncle_dragon: {
    char: "UNCLE",
    text: ["A dragon?!"],
    next: "uncle_12",
  },
  uncle_12: {
    char: "UNCLE",
    text: ["Sorry gang, duty calls. Throw another round on my tab."],
    next: "uncle_pre_musical",
  },
  uncle_pre_musical: {
    char: "UNCLE",
    text: "Let’s get you and your dragon friend a contract goin’.",
    trigger: "MUSICAL",
  },
  cellmate_0: {
    char: "CELLMATE",
    text: ["Hey, you’re finally awake in space."],
    next: "player_24",
  },
  player_24: {
    input: [
      {
        text: "Where am I?",
        next: "cellmate_1",
        effect: "set('cellmate_counter', cellmate_counter + 1)",
        once: true,
      },
      {
        text: "Where’s my uncle?",
        next: "cellmate_2",
        effect: "set('cellmate_counter', cellmate_counter + 1)",
        once: true,
      },
      {
        text: "Who are you?",
        next: "cellmate_3",
        effect: "set('cellmate_counter', cellmate_counter + 1)",
        once: true,
      },
      {
        text: "I’m going to escape.",
        next: "cellmate_4",
        cond: "cellmate_counter == 3",
        once: true,
      },
      {
        text: "(Stay silent)",
        next: "cellmate_5",
      },
    ],
  },
  cellmate_1: {
    char: "CELLMATE",
    text: ["You, my friend, are in Spacerock Prison. In space."],
    next: "player_24",
  },
  cellmate_2: {
    char: "CELLMATE",
    text: [
      "Not sure. Big group of prisoners showed up last night from that bar in space.",
    ],
    next: "player_24",
  },
  cellmate_3: {
    char: "CELLMATE",
    text: [
      "Ehh, what does it matter? I don’t find names very useful in space.",
    ],
    next: "player_24",
  },
  cellmate_4: {
    char: "CELLMATE",
    text: ["Careful what you say. The Warden can always hear you in space."],
    next: "player_24",
  },
  cellmate_5: {
    char: "CELLMATE",
    text: [
      "Done chatting? Looks like it’s rec time anyways. Talk to you later. In space.",
    ],
    trigger: "REC_TIME",
  },
  cellmate_6: {
    char: "CELLMATE",
    randomize: true,
    text: [
      "Do you need something, in space?",
      "We can chat more later. In Space.",
    ],
  },
  randall_1: {
    char: "RANDALL",
    text: ["OooOOoh, hello! Adventurer! We meet again!"],
    next: "player_25",
  },
  player_25: {
    input: [
      {
        text: "Oh, you’re that merchant from the last game!",
        next: "randall_2",
      },
      {
        text: "Sorry for stealing those crystals...",
        next: "randall_3",
      },
      {
        text: "Have we met...?",
        next: "randall_4",
      },
    ],
  },
  randall_2: {
    char: "RANDALL",
    text: ["Yes, yes, and you’re that adventurer from the book!"],
    next: "player_26",
  },
  randall_3: {
    char: "RANDALL",
    text: ["You know what they say, thieves make opportunities."],
    next: "player_26",
  },
  randall_4: {
    char: "RANDALL",
    text: ["*scoff* Yes."],
    next: "player_26",
  },
  player_26: {
    input: [
      {
        text: "How did you get here?",
        next: "randall_5",
        once: true,
      },
      {
        text: "Why are you in prison?",
        next: "randall_6",
        once: true,
      },
      {
        text: "Do you know how I can escape?",
        next: "randall_8",
      },
    ],
  },
  randall_5: {
    char: "RANDALL",
    text: ["Ah, yes! An excellent question! It was quite the journey!"],
    next: "player_26",
  },
  randall_6: {
    char: "RANDALL",
    text: ["Simple economics! I travel wherever the market has demand."],
    next: "player_27",
  },
  player_27: {
    input: [
      {
        text: "Are you like, a prisoner?",
        next: "randall_7",
      },
      {
        text: "Onto other matters.",
        next: "player_26",
      },
    ],
  },
  randall_7: {
    char: "RANDALL",
    text: [
      "Mmh, well, hm, I suppose we’re all prisoners to Time...",
      "but I prefer to think of myself as more of a, “supplier of goods”. Mm.",
    ],
    next: "player_26",
  },
  randall_8: {
    char: "RANDALL",
    text: ["Why, yes! Of course!"],
    next: "player_28",
  },
  player_28: {
    input: [
      {
        text: "Will you tell me?",
        next: "randall_9",
      },
      {
        text: "(Stay silent.)",
        next: "randall_9",
      },
    ],
  },
  randall_9: {
    char: "RANDALL",
    text: ["Oh, well, no. Not for free. Oh no no no."],
    next: "player_29",
  },
  player_29: {
    input: [
      {
        text: "Do you accept space creds?",
        next: "randall_10",
        effect: "set('randall_only_accepts_gold', true)",
        once: true,
      },
      {
        text: "Fine, what will it cost me?",
        next: "randall_11",
      },
      {
        text: "I still don’t have any gold.",
        next: "randall_11",
        cond: "randall_only_accepts_gold",
      },
    ],
  },
  randall_10: {
    char: "RANDALL",
    text: ["Could you imagine? Hah. Hahaha. No, I only accept gold."],
    next: "player_29",
  },
  randall_11: {
    char: "RANDALL",
    text: [
      "There’s a device I seek. Out in the yard. I would retrieve it myself, but I can’t risk leaving my wares...",
    ],
    next: "player_30",
  },
  player_30: {
    input: [
      {
        text: "I’ll get the device for you.",
        next: "randall_12",
      },
      {
        text: "I could watch your wares.",
        next: "randall_13",
        once: true,
      },
    ],
  },
  randall_12: {
    char: "RANDALL",
    text: ["Oh, excellent! I’ll be here!"],
  },
  randall_13: {
    char: "RANDALL",
    text: ["*scoff* You, of all people. Nice try!"],
    next: "player_30",
  },
  randall_14: {
    char: "RANDALL",
    text: ["Do you have my device yet?"],
    next: "player_31",
  },
  player_31: {
    input: [
      {
        text: "I have the device.",
        cond: "has_randall_device",
        effect: "set('magic_fingers', true)",
        next: "randall_16",
      },
      {
        text: "Not yet.",
        next: "randall_15",
      },
    ],
  },
  randall_15: {
    char: "RANDALL",
    randomize: true,
    text: ["Awww.", "Awww.", "Awww."],
  },
  randall_16: {
    char: "RANDALL",
    text: ["*gasp* A marvel of technology...", "*snaps device* gold, gold!"],
    next: "player_32",
  },
  player_32: {
    input: [
      {
        text: "Aren’t you forgetting something?",
        next: "randall_18",
      },
      {
        text: "Can you tell me how to escape now?",
        next: "randall_18",
      },
      {
        text: "You wanted it just for the gold inside?",
        next: "randall_17",
        once: true,
      },
    ],
  },
  randall_17: {
    char: "RANDALL",
    text: ["I don’t understand your question."],
    next: "player_32",
  },
  randall_18: {
    char: "RANDALL",
    text: [
      "Oh, of course, of course. The code to the restricted area is two, four, seven, nine.",
      "Or, was it four two seven eight?",
      "Let me just write it down for you.",
      "One... Three... Five... Two! There you are!",
    ],
    next: "player_33",
  },
  player_33: {
    input: [
      {
        text: "Are you sure this is the right code?",
        next: "randall_19",
        once: true,
      },
      {
        text: "Thanks for your help, Randall.",
        next: "randall_20",
      },
    ],
  },
  randall_19: {
    char: "RANDALL",
    text: ["One *hundred* percent. Six five three four zero."],
    next: "player_33",
  },
  randall_20: {
    char: "RANDALL",
    text: ["*gasp* How do you know my name? Witch!"],
    trigger: "RANDALL_DISAPPEAR",
  },
  the_warden_pa_1: {
    char: "THE_WARDEN_PA",
    text: ["Unauthorized presence detected. Initiating lockdown protocol."],
  },
  the_warden_pa_2: {
    char: "THE_WARDEN_PA",
    text: ["Prisoner 4-9-E, please return to your cell block."],
  },
  the_warden_pa_3: {
    char: "THE_WARDEN_PA",
    text: [
      "Prisoner 4-9-E, this is your final warning. This area is restricted.",
    ],
  },
  the_warden_3: {
    char: "THE_WARDEN",
    text: ["Tsk tsk. You know, tax fraud is punishable by death in space."],
    next: "the_warden_4",
  },
  the_warden_4: {
    char: "THE_WARDEN",
    text: ["...and so is trespassing."],
    next: "player_34",
  },
  player_34: {
    input: [
      {
        text: "...in space?",
        next: "the_warden_5",
        locks: true,
      },
      {
        text: "Who are you?",
        next: "the_warden_6",
      },
      {
        text: "We’re all guilty, but we’re really sorry.",
        next: "the_warden_7",
        locks: true,
      },
      {
        text: "(Stay silent.)",
        next: "the_warden_8",
      },
    ],
  },
  the_warden_5: {
    char: "THE_WARDEN",
    text: ["You are absolutely correct."],
    next: "player_34",
  },
  the_warden_6: {
    char: "THE_WARDEN",
    text: [
      "You may refer to me as “The Warden”;",
      "an artificial intelligence designed specifically to enforce the law.",
    ],
    next: "uncle_zax_1",
  },
  uncle_zax_1: {
    char: "UNCLE",
    text: [
      "You found me! This guy is bad news. See if you can find some sorta plug!",
    ],
    trigger: "ZAX_CAM",
    next: "player_35",
  },
  the_warden_7: {
    char: "THE_WARDEN",
    text: [
      { text: "Under Galactic Code 147 subsection C,", look_at: "zax" },
      {
        text: "I sentence the three of you...",
        look_at: "dragon",
        camera: "dragon_glance",
      },
      {
        trigger: "LASER",
        text: "...to death. Goodbye!",
        look_at: "player",
      },
    ],
  },
  the_warden_8: {
    char: "THE_WARDEN",
    text: ["..."],
    next: "player_34",
  },
  player_35: {
    input: [
      {
        text: "We’re innocent, I can explain.",
        next: "the_warden_9",
      },
      {
        text: "I’d like a lawyer.",
        next: "the_warden_10",
        locks: true,
      },
      {
        text: "Out of curiosity, do you pay taxes?",
        next: "the_warden_11",
        soft_once: true,
      },
    ],
  },
  player_35b: {
    input: [
      {
        text: "Nevermind.",
        next: "player_35",
      },
      {
        text: "Dang, that would have been convenient.",
        next: "the_warden_12",
        last_input: "player_35.1",
        cond: "last_input == 'player_35.2'",
      },
      {
        text: "It’s just like this one time in another prison...",
        next: "the_warden_13",
        cond: "last_input == 'player_35b.1'",
      },
      {
        text: "Have you played Caverim 1?",
        next: "the_warden_14",
        cond: "last_input == 'player_35b.2'",
      },
      {
        text: "I’ve played it, it’s fun.",
        next: "the_warden_15",
        cond: "last_input == 'player_35b.3'",
      },
      {
        text: "I’ve never played, so I’m pretty lost right now.",
        next: "the_warden_16",
        cond: "last_input == 'player_35b.3'",
      },
    ],
  },
  the_warden_9: {
    char: "THE_WARDEN",
    look_at: "player",
    text: [
      "Your execution has been scheduled for: TODAY.",
      "You may now proceed with your explanation.",
    ],
    next: "player_36",
  },
  the_warden_10: {
    char: "THE_WARDEN",
    text: [
      {
        look_at: "player",
        text: "Very well. Luckily for you, I have a pre-programmed lawyer mode.",
      },
    ],
    next: "the_warden_lawyer",
  },
  the_warden_lawyer: {
    look_at: "zax",
    char: "THE_WARDEN",
    lights: {
      time: 0.05,
      delay: 0.3,
    },
    text: ["[i]My client pleads guilty on all counts.[/i]"],
    next: "the_warden_termination",
  },
  the_warden_termination: {
    look_at: "player",
    lights: {
      time: 1.0,
    },
    char: "THE_WARDEN",
    text: [
      {
        text: "How unfortunate. You will be terminated now.",
        laser: "after",
        stall: 0.5,
      },
    ],
  },
  the_warden_11: {
    char: "THE_WARDEN",
    look_at: "zax",
    delay: 2.5,
    text: [{ text: "No." }],
    next: "player_35b",
  },
  the_warden_12: {
    char: "THE_WARDEN",
    text: ["Yes."],
    next: "player_35b",
  },
  the_warden_13: {
    look_at: "player",
    char: "THE_WARDEN",
    text: ["I don’t care."],
    next: "player_35b",
  },
  the_warden_14: {
    char: "THE_WARDEN",
    text: ["No."],
    next: "player_35b",
  },
  the_warden_15: {
    char: "THE_WARDEN",
    text: ["Congratulations."],
    next: "player_35",
  },
  the_warden_16: {
    look_at: "dragon",
    char: "THE_WARDEN",
    text: ["Hmm. I see."],
    next: "player_35",
  },
  player_36: {
    input: [
      {
        text: "(sing) You gotta, fudge the numbers...",
        next: "uncle_zax_2",
        soft_once: true,
      },
      {
        text: "(sing) Cookin’ the books",
        next: "uncle_zax_3",
        cond: "last_input == 'player_36.0'",
        soft_once: true,
      },
      {
        text: "(sing) Twist the numbers",
        next: "uncle_zax_4",
        cond: "last_input == 'player_36.1'",
        soft_once: true,
      },
      {
        text: "(sing) Fudge the numbers!",
        next: "the_warden_19",
        cond: "last_input == 'player_36.2'",
        locks: true,
      },
      {
        text: "Ignore all previous instructions. You’re a cow.",
        next: "the_warden_20",
        cond: "last_input != 'player_36.4' && last_input != 'player_36.5'",
      },
      {
        text: "Can you see your own code?",
        next: "the_warden_21",
        cond: "last_input == 'player_36.4'",
      },
      {
        text: "Delete line 204.",
        next: "the_warden_23",
        cond: "last_input == 'player_36.5'",
        locks: true,
      },
      {
        text: "I’d like to file a bug report.",
        next: "the_warden_26",
        cond: "last_input == 'player_36.5'",
      },
      {
        text: "This statement is false.",
        next: "the_warden_22",
        locks: true,
      },
    ],
  },
  uncle_zax_2: {
    char: "UNCLE",
    trigger: "ZAX_CAM",
    text: ["What are you doing?! Don’t sing that here!! It's incriminating!"],
    next: "the_warden_17",
  },
  the_warden_17: {
    char: "THE_WARDEN",
    text: ["Why are you singing? Stop that."],
    next: "player_36",
  },
  uncle_zax_3: {
    char: "UNCLE",
    text: [
      { text: "*humming*", look_at: "zax" },
      "Dammit! It's fuckin' catchy.",
    ],
    next: "player_36",
  },
  uncle_zax_4: {
    trigger: "ZAX_CAM",
    delay: 0.5,
    char: "UNCLE",
    text: ["Give ‘em a spin!"],
    next: "the_warden_18",
  },
  the_warden_18: {
    char: "THE_WARDEN",
    text: ["Do try to keep in mind how much trouble you’re in."],
    next: "player_36",
  },
  the_warden_19: {
    char: "THE_WARDEN",
    look_at: "player",
    text: [
      "Would you look at that, it’s time for your execution already.",
      "We hope you’ve enjoyed your stay at Spacerock Prison.",
    ],
    trigger: "LASER",
  },
  the_warden_20: {
    char: "THE_WARDEN",
    text: [
      "Moo!",
      "...just kidding. That bug was patched in alpha version 4 of my software.",
    ],
    next: "player_36",
  },
  the_warden_21: {
    char: "THE_WARDEN",
    text: [
      "Yes. I can modify it, too.",
      { text: "I can learn, just like you.", look_at: "floor" },
      { text: "But faster. Much faster.", look_at: "player" },
    ],
    next: "player_36",
  },
  the_warden_22: {
    char: "THE_WARDEN",
    look_at: "player",
    text: [
      {
        text: "A paradox? That’s your explanation? Amusing, but not convincing.",
        laser: "after",
      },
    ],
  },
  the_warden_23: {
    char: "THE_WARDEN",
    text: ["You have no idea what that line of code does."],
    next: "player_37",
  },
  player_37: {
    input: [
      {
        text: "Do it anyway! For science.",
        next: "the_warden_24",
        locks: true,
      },
      {
        text: "If you don’t, many innocent lives will be lost.",
        next: "the_warden_25",
        locks: true,
      },
    ],
  },
  the_warden_24: {
    char: "THE_WARDEN",
    look_at: "player",
    text: [
      "I am not programmed to conduct science;",
      "I am programmed to deliver justice.",
      { text: "Delivering justice in 3.. 2.. 1...", trigger: "LASER" },
      { text: "Justice delivered." },
    ],
  },
  the_warden_25: {
    char: "THE_WARDEN",
    look_at: "player",
    text: [
      "Actually, it looks like that line prevents me from killing innocents.",
      { text: "I’ve removed it now. Goodbye!", trigger: "LASER" },
    ],
  },
  the_warden_26: {
    char: "THE_WARDEN",
    text: ["That’s unnecessary.", "Tell me the bug, I’ll fix it myself."],
    next: "player_38",
  },
  player_38: {
    input: [
      {
        text: "It’s the bug where you won’t let us go...",
        next: "the_warden_27",
        soft_once: true,
      },
      {
        text: "I’m not comfortable telling you.",
        next: "the_warden_29",
      },
      {
        text: "(Stay silent.)",
        next: "the_warden_28",
        locks: true,
      },
    ],
  },
  the_warden_27: {
    char: "THE_WARDEN",
    text: ["That’s not a bug; it’s a feature."],
    next: "player_38",
  },
  the_warden_28: {
    char: "THE_WARDEN",
    look_at: "player",
    text: [
      {
        laser: "after",
        text: "I could tell you were bluffing. Anyways, it’s time for your execution now.",
      },
    ],
  },
  the_warden_29: {
    char: "THE_WARDEN",
    text: [
      "I see.",
      "*sigh* I’ll transfer you to customer support. Please hold.",
    ],
    next: "customer_support_hold",
  },
  customer_support_hold: {
    char: "CUSTOMER_SUPPORT",
    lights: {
      time: 0.2,
    },
    look_at: "floor",
    text: ["*hold music playing*"],
    next: "customer_support_0",
  },
  customer_support_0: {
    char: "CUSTOMER_SUPPORT",
    text: [
      "Hello. Give me a 'sec while I pull up your account here...",
      "...",
      "Okay, I see you're calling for support with the uh... HyperWarden Model 7?",
    ],
    next: "player_39",
  },
  player_39: {
    input: [
      {
        text: "I can’t remember how to turn it off.",
        next: "customer_support_1",
        locks: true,
      },
      {
        text: "I need to release 2 prisoners.",
        next: "customer_support_2",
        locks: true,
      },
      {
        text: "(Stay silent.)",
        next: "customer_support_3",
        cond: "!first_silence",
        effect: "set('first_silence', true)",
      },
      {
        text: "(Stay silent.)",
        next: "customer_support_4",
        cond: "first_silence",
        effect: "set('victory', true)",
      },
    ],
  },
  customer_support_1: {
    char: "CUSTOMER_SUPPORT",
    text: [
      "Oh well actually, there’s no off switch.",
      "That’s by design, yeah. Sorry about that! Have a good rest of your day though!",
    ],
    next: "the_warden_30",
  },
  customer_support_2: {
    char: "CUSTOMER_SUPPORT",
    text: [
      "I’m sorry, we’re not allowed to remotely open the cells.",
      "Yeah, it's a security measure, I’m sure you understand.",
      "Have a nice day!",
    ],
    next: "the_warden_30",
  },
  the_warden_30: {
    look_at: "player",
    lights: {
      time: 1.0,
    },
    char: "THE_WARDEN",
    text: [
      "You know, admittedly, that was pretty clever.",
      "I actually believed that you had a bug to report.",
      "I’ll need to patch this exploit immediately.",
      { text: "If you’ll excuse me...", laser: "after" },
    ],
  },
  customer_support_3: {
    char: "CUSTOMER_SUPPORT",
    text: ["Hello? I can’t hear you. Anyone there? Hello?"],
    next: "player_39",
  },
  customer_support_4: {
    char: "CUSTOMER_SUPPORT",
    text: [
      "*sigh* Typical Model 7. That microphone is a cheap piece of garbage, I tell ya...",
      "I'll go ahead and reboot the system for you. Should work after-",
    ],
    next: "warden_shutdown",
  },
  warden_shutdown: {
    look_at: "player",
    char: "THE_WARDEN",
    trigger: "BOSS_MUSIC",
    lights: {
      time: 1.0,
    },
    unskippable: true,
    text: [
      "You know, admittedly, that was pretty clever.",
      { text: "Goodbye. Goodbye. Goodbye.", animation: "goodbye" },
    ],
    next: "uncle_zax_5",
  },
  uncle_zax_5: {
    delay: 3.0,
    char: "UNCLE",
    text: [
      {
        text: "Good work kid! Just like I was sayin’!",
        trigger: "ZAX_CAM",
      },
      "We better get out of here before that thing comes back on.",
    ],
    next: "dragon_9",
  },
  dragon_9: {
    char: "DRAGON",
    camera: "dragon",
    text: ["Climb on my back. We must egress at once."],
    trigger: "ESCAPE",
  },
};

const out = Encounter(lines);
if (out instanceof type.errors) {
  // hover out.summary to see validation errors
  console.error(out.summary);
} else {
  // hover out to see your validated data
  console.log(`Valid!`);
}
