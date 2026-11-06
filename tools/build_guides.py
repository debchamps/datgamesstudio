#!/usr/bin/env python3
"""Generate the /how-to-play/ hub and one rules page per game.

Rules text follows each app's own in-game rules (strings.xml / rules engines), so a
guide never describes a variant the app doesn't play. Edit GAMES below, then run:

    python3 tools/build_guides.py
"""
from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://www.datgamesstudio.com"
PLAY = "https://play.google.com/store/apps/details?id={pkg}&utm_source=website&utm_medium=organic&utm_campaign=how_to_play&utm_content={slug}"
APPLE = "https://apps.apple.com/app/id{id}"
UPDATED = "2026-11-06"

# Each section is (heading, html body). Bodies are trusted, hand-written HTML.
GAMES: list[dict] = [
    {
        "slug": "callbreak",
        "name": "Callbreak",
        "icon": "callbreak",
        "accent": "#128a68",
        "pkg": "com.datgames.CallbreakCardGame",
        "ios": "1606221936",
        "kind": "Trick-taking · Spades trump",
        "lede": "Callbreak is a four-player trick-taking game from Nepal and India. Spades are always trump, every player calls how many tricks they will win, and you must beat the winning card whenever you can.",
        "facts": ["4 players, each on their own", "52-card deck", "5 deals per match", "Play goes anticlockwise"],
        "glance": [
            "Spades are always trump.",
            "Before play, call 1 to 8 tricks.",
            "Follow suit, and beat the winning card if you can.",
            "No card of the led suit? Play a spade if you have one.",
            "Make your call to score it; miss it and you lose it.",
        ],
        "sections": [
            ("Setup", "<p>Deal all 52 cards, 13 to each player. Cards rank A K Q J 10 9 8 7 6 5 4 3 2 in every suit. Each deal has 13 tricks, and a match is 5 deals.</p>"),
            ("Calling", "<p>After looking at your hand, call the number of tricks you expect to win, from 1 to 8. Your call is your own target: there are no partners in Callbreak, and the four calls don't have to add up to 13.</p>"),
            ("Playing a trick", "<p>The leader plays any card. Going anticlockwise, everyone else plays one card:</p><ul><li><strong>Follow suit</strong> if you can, and play <strong>higher than the card currently winning</strong> if you can. This “must beat” rule is what makes Callbreak different from Spades.</li><li>If you have none of the suit led, you <strong>must play a spade</strong> (cut), beating any spade already played if you can.</li><li>Only with no led-suit cards and no spades may you play anything else.</li></ul><p>The highest spade wins the trick; if no spade was played, the highest card of the led suit wins. The winner leads the next trick.</p>"),
            ("Scoring", "<ul><li><strong>Made it exactly:</strong> call 4, win 4 → <strong>+4</strong>.</li><li><strong>Overtricks:</strong> each extra trick is worth 0.1. Call 4, win 6 → <strong>+4.2</strong>.</li><li><strong>Missed:</strong> win fewer than you called and you lose your call. Call 4, win 3 → <strong>−4</strong>.</li></ul><p>After 5 deals, the highest total wins.</p>"),
        ],
        "tips": [
            "Count your sure tricks: Aces, protected Kings and long spades. Call a little under when in doubt, since missing costs your whole call.",
            "Short suits are valuable: once you are void, you can cut with small spades.",
            "Because you must beat the winning card, a high card can be dragged out of your hand. Lead suits that force opponents to waste their big cards.",
        ],
        "faq": [
            ("Is Callbreak the same as Spades?", "They are cousins. Both use spades as trump, but Callbreak has no partners, calls start at 1, and you must beat the winning card whenever you can."),
            ("What is the highest call?", "In our app you can call from 1 to 8 tricks."),
        ],
    },
    {
        "slug": "twenty-nine",
        "name": "29 (Twenty Nine)",
        "short": "29",
        "icon": "twentynine",
        "accent": "#b98a2b",
        "pkg": "debakesh.com.twentynine",
        "ios": None,
        "kind": "Partnership · Point bidding",
        "lede": "29 is a partnership card game from India and Bangladesh. Jacks and nines are the top cards, teams bid on how many card points they will collect, and the bid winner hides the trump suit until someone asks to see it.",
        "facts": ["4 players in 2 teams", "32-card deck", "8 tricks per deal", "Play goes anticlockwise"],
        "glance": [
            "Card order: J 9 A 10 K Q 8 7.",
            "Points: J 3, 9 2, A 1, 10 1. 28 in the deck.",
            "Bid 16 to 28. The winner picks trump in secret.",
            "Follow suit; if you can't, you may ask to see trump.",
            "Make the bid +1, miss it −1. First to +6 wins.",
        ],
        "sections": [
            ("Setup", "<p>Use a 32-card deck (7 to Ace in each suit). Your partner sits opposite you. Each player gets 8 cards, so a deal has 8 tricks.</p><p>Inside each suit the order, high to low, is <strong>J 9 A 10 K Q 8 7</strong>. The Jack beats every other card of its suit.</p>"),
            ("Card points", "<p>Only four ranks are worth points: <strong>Jack 3, Nine 2, Ace 1, Ten 1</strong>. Everything else is 0, so the deck holds 28 points. The team that wins a trick collects the points in it.</p>"),
            ("Bidding and hidden trump", "<p>Players bid how many points their team will collect, from <strong>16 up to 28</strong>, or pass. The highest bidder chooses a trump suit and places it face down without telling anyone.</p>"),
            ("Playing a trick", "<ul><li>Follow the suit led if you can.</li><li>If you can't, you may play any card, <strong>or ask to see trump</strong>. Once trump is shown, you must play a trump if you have one.</li><li>After trump is revealed, any trump beats every other suit. Otherwise the highest card of the led suit wins.</li></ul>"),
            ("Pair (Marriage)", "<p>Holding the King and Queen of trump in one hand is a <strong>pair</strong>. After trump is shown and your team wins a trick, the pair moves the bid by 4 points in your team's favour.</p>"),
            ("Scoring and winning", "<p>If the bidding team collects at least its bid, it gains a game point (+1); otherwise it loses one (−1). The first team to <strong>+6</strong> wins the match.</p><p>The app also offers optional house rules, such as a last-trick bonus point or making the first player open at 16. All are off by default.</p>"),
        ],
        "tips": [
            "Jacks and nines decide most deals. A suit with J-9 is strong enough to bid on.",
            "Feed points to your partner's winning tricks: drop an Ace or Ten when they are sure to win.",
            "Don't ask for trump too early if you hold no trumps. Sometimes a discard is better.",
        ],
        "faq": [
            ("Why is it called 29?", "The four point cards add up to 28, and classic rules give 1 extra point for the last trick, making 29. Our app offers that as an optional rule."),
            ("Can I play 29 on iPhone?", "29 is on Google Play now, and the iPhone version is coming soon."),
        ],
    },
    {
        "slug": "tarneeb",
        "name": "Tarneeb",
        "icon": "tarneeb",
        "accent": "#5b3b6f",
        "pkg": "com.datgames.tarneeb",
        "ios": "6785555890",
        "kind": "Partnership · Trick bidding",
        "lede": "Tarneeb (طرنيب) is the favourite partnership trick game of the Levant and the Gulf. Teams bid how many tricks they will take, the highest bidder names trump, and the first team to the target score wins.",
        "facts": ["4 players in 2 teams", "52-card deck", "13 tricks per deal", "English & Arabic"],
        "glance": [
            "Bid 7 to 13 tricks for your team.",
            "The highest bidder names trump.",
            "Follow the suit led if you can.",
            "Make the bid to score your tricks; miss it and lose the bid.",
            "First team to 41 wins.",
        ],
        "sections": [
            ("Setup", "<p>All 52 cards are dealt, 13 each. Partners sit opposite. Cards rank A K Q J 10 … 2.</p>"),
            ("Bidding", "<p>Starting left of the dealer, each player either passes or bids a higher number of tricks, from <strong>7 to 13</strong>, that their team will take. If everyone passes, the dealer must bid 7. The highest bidder names the trump suit (the <em>tarneeb</em>) and leads the first trick.</p>"),
            ("Playing a trick", "<p>Follow the suit led if you can. If you can't, play any card, including a trump. The highest trump wins the trick; if no trump is played, the highest card of the suit led wins.</p>"),
            ("Scoring", "<ul><li><strong>Bid made:</strong> the bidding team scores every trick it took. Bid 8, take 9 → <strong>+9</strong>; the other team scores 0.</li><li><strong>Bid missed:</strong> the bidding team loses its bid (bid 8 → <strong>−8</strong>), and the defenders score the tricks they took.</li></ul>"),
            ("Winning", "<p>The first team to reach <strong>41</strong> wins the match.</p>"),
            ("Variants", "<p>Besides Standard Tarneeb, the app offers <strong>Egyptian (Masrawy)</strong>, where the bid also names the suit and can be doubled or redoubled, and <strong>Syrian 41</strong>, where trump comes from the last card dealt and each player bids and scores on their own.</p>"),
        ],
        "tips": [
            "Count your partner in: a bid of 7 needs roughly 3–4 tricks from your own hand.",
            "Lead trumps early when you hold several; it stops opponents cutting your winners.",
            "When defending, every trick you take counts if the bidders fail, so keep fighting.",
        ],
        "faq": [
            ("What does tarneeb mean?", "It is the Arabic word for the trump suit."),
            ("Is Tarneeb like Spades?", "Both are partnership bidding games, but in Tarneeb the bid winner chooses trump and the team bids together."),
        ],
    },
    {
        "slug": "hokm",
        "name": "Hokm",
        "icon": "hokm",
        "accent": "#b0413c",
        "pkg": "com.datgames.hokm",
        "ios": None,
        "kind": "Partnership · Trump & tricks",
        "lede": "Hokm (حکم) is the classic Persian partnership game. There is no auction: the Hâkem picks trump after seeing just five cards, and the first team to seven tricks wins the hand.",
        "facts": ["4 players in 2 teams", "52-card deck", "First to 7 tricks", "Game to 7 points"],
        "glance": [
            "The Hâkem sees 5 cards and names trump.",
            "Follow the suit led if you can.",
            "First team to 7 tricks wins the hand.",
            "A sweep (Kot) scores extra.",
            "First team to 7 points wins.",
        ],
        "sections": [
            ("Setup and the Hâkem", "<p>Partners sit opposite. One player is the <strong>Hâkem</strong> (ruler). The Hâkem is dealt 5 cards first and declares the trump suit from those five. Then the rest of the deck is dealt so everyone holds 13.</p>"),
            ("Playing a trick", "<p>The Hâkem leads the first trick. Follow the suit led if you can; otherwise play any card. The highest trump wins, or the highest card of the suit led if no trump was played.</p>"),
            ("Winning a hand", "<p>The first team to take <strong>7 tricks</strong> wins the hand and scores 1 point. If the hand is a <strong>Kot</strong> (a 7–0 sweep), it is worth more: 2 points when the Hâkem's team sweeps, 3 when the opponents sweep the Hâkem.</p>"),
            ("Winning the game", "<p>The first team to <strong>7 points</strong> wins. If the Hâkem's team loses a hand, the Hâkem role passes to the next player.</p>"),
            ("Court Piece", "<p>The app also includes <strong>Court Piece</strong>, the South Asian version of the same game, where a sweep (a “court”) is worth 2 to either side.</p>"),
        ],
        "tips": [
            "As Hâkem, pick the suit where your five cards are longest, not just highest.",
            "Count trumps: there are 13, and knowing how many are left wins the late tricks.",
            "Watch for a Kot: if the opponents have none after five tricks, fight hard for just one.",
        ],
        "faq": [
            ("What does Hokm mean?", "It means “command” in Persian: the Hâkem commands the trump suit."),
            ("Can I play Hokm on iPhone?", "Hokm is on Google Play now, and the iPhone version is coming soon."),
        ],
    },
    {
        "slug": "hearts",
        "name": "Hearts",
        "icon": "hearts",
        "accent": "#c73636",
        "pkg": "com.datgames.hearts",
        "ios": "1620761646",
        "kind": "Trick avoidance",
        "lede": "Hearts is the classic game of avoiding points. Every heart you take costs you, the Queen of Spades costs a lot more, and the lowest score wins, unless someone shoots the moon.",
        "facts": ["4 players, each on their own", "52-card deck", "No trump suit", "Game to 100"],
        "glance": [
            "Pass 3 cards before each deal (left, right, across, hold).",
            "The 2♣ leads the first trick.",
            "Each heart = 1 point. Q♠ = 13.",
            "No leading hearts until one has been played.",
            "Lowest score when someone hits 100 wins.",
        ],
        "sections": [
            ("Setup and passing", "<p>Deal 13 cards to each player. Before play, everyone passes 3 cards: to the left on the first deal, then right, then across, then no pass, and repeat.</p>"),
            ("Playing a trick", "<p>Whoever holds the <strong>2♣</strong> leads it to the first trick. Follow the suit led if you can; if not, play any card. There is no trump: the highest card of the led suit wins.</p><p>You can't lead hearts until a heart has been played on another suit (“hearts are broken”).</p>"),
            ("Scoring", "<p>Each heart you capture is <strong>1 point</strong> and the <strong>Q♠ is 13</strong>, so a deal holds 26 points. Points are bad.</p><p><strong>Shoot the moon:</strong> capture all 26 and you score 0 while everyone else gets 26.</p>"),
            ("Winning", "<p>The match ends when someone reaches <strong>100</strong>. The player with the <strong>lowest</strong> score wins.</p>"),
        ],
        "tips": [
            "Pass away high spades (A♠, K♠) if you don't hold the Q♠; they can catch it.",
            "Try to get void in a suit early so you can dump hearts and the Q♠ on others.",
            "Watch for a moon shot: if one player is taking every heart, keep one heart for yourself.",
        ],
        "faq": [
            ("What is shooting the moon?", "Taking all 13 hearts and the Q♠ in one deal. Instead of 26 points, you score 0 and every opponent gets 26."),
            ("How is Bray different from Hearts?", "Bray has no passing, no 2♣ rule, hearts can be led any time, the Q♠ is worth 12 and taking no tricks earns a −12 bonus."),
        ],
    },
    {
        "slug": "spades",
        "name": "Spades",
        "icon": "spades",
        "accent": "#2a4f93",
        "pkg": "com.datgames.spade",
        "ios": "6443504649",
        "kind": "Partnership · Trick bidding",
        "lede": "Spades is America's favourite partnership card game. Bid the tricks you'll take, spades always trump, and watch your bags: overtricks come back to bite.",
        "facts": ["4 players in 2 teams", "52-card deck", "Spades always trump", "Game to 500"],
        "glance": [
            "Each player bids tricks; partners add their bids.",
            "Spades are always trump.",
            "You can't lead spades until they're broken.",
            "Make it: 10 × bid + bags. Miss it: −10 × bid.",
            "Nil: take no tricks for +100.",
        ],
        "sections": [
            ("Setup", "<p>Deal 13 cards each. Partners sit opposite. Cards rank A K Q … 2, and <strong>spades always trump</strong>.</p>"),
            ("Bidding", "<p>Each player bids the number of tricks they expect to take. Partners' bids are added together into the team's contract. You may also bid <strong>Nil</strong>, promising to take no tricks at all: <strong>+100</strong> if you take none, <strong>−100</strong> if you take any.</p>"),
            ("Playing a trick", "<ul><li>Follow the suit led if you can; otherwise play any card, including a spade.</li><li>The highest spade wins; if none was played, the highest card of the led suit wins.</li><li>Spades can't be led until a spade has been played on another suit (“spades are broken”), unless you hold only spades.</li></ul>"),
            ("Scoring", "<ul><li><strong>Contract made:</strong> 10 points per trick bid, plus 1 per extra trick (a <em>bag</em>). Bid 5, take 7 → <strong>52</strong>.</li><li><strong>Contract missed:</strong> lose 10 per trick bid. Bid 5, take 4 → <strong>−50</strong>.</li><li><strong>Sandbags (optional, in Settings):</strong> bags add up across deals, and every 10 bags costs 100 points.</li></ul>"),
            ("Winning", "<p>The first team to <strong>500</strong> wins (you can change the target in Settings).</p>"),
            ("Variants", "<p>The app also offers <strong>Cutthroat</strong> (every player for themselves), <strong>Jokers</strong> (Big Joker, Little Joker, 2♦ and 2♠ as the top four trumps) and a <strong>Board rule</strong> where a team's bids must total at least 4.</p>"),
        ],
        "tips": [
            "Count Aces and Kings outside spades as about one trick each, then add your long spades.",
            "Bid a little low late in a game only if bags won't push you over 10.",
            "Protect your partner's Nil: win tricks they might be forced to take.",
        ],
        "faq": [
            ("What are bags in Spades?", "Tricks your team takes beyond its bid. Each is worth 1 point. With the sandbag rule switched on, every 10 you collect costs 100."),
            ("Can I play Spades without a partner?", "Yes. Switch on Cutthroat in the app's settings, and every player scores on their own."),
        ],
    },
    {
        "slug": "bridge",
        "name": "Bridge",
        "icon": "bridge",
        "accent": "#1f5fae",
        "pkg": "com.datgames.bridge",
        "ios": "6827570630",
        "kind": "Partnership · Contract bidding",
        "lede": "Contract bridge is the deepest of the trick-taking games, and easier to start than its reputation. Count your points, win the auction, then play your hand and your partner's.",
        "facts": ["4 players in 2 teams", "52-card deck", "Auction, then play", "Chicago scoring"],
        "glance": [
            "Count points: A 4, K 3, Q 2, J 1. About 12 opens.",
            "A bid = tricks over six + a trump suit or No Trump.",
            "Each bid beats the last: ♣ ♦ ♥ ♠ NT, low to high.",
            "Declarer plays both their own hand and dummy's.",
            "Make the contract to score; bonuses for game and slam.",
        ],
        "sections": [
            ("Setup", "<p>Deal 13 cards each. You (South) and North are partners against East and West. Count your <strong>high-card points</strong>: Ace 4, King 3, Queen 2, Jack 1. The pack holds 40; about 12 is enough to open the bidding.</p>"),
            ("The auction", "<p>Starting with the dealer, each player bids, passes or doubles. A bid is a number of tricks <strong>over six</strong> plus a trump suit or No Trump: <strong>2♥</strong> means 8 tricks with hearts as trumps.</p><p>Each bid must beat the last: a higher number, or the same number in a higher strain (♣ ♦ ♥ ♠ NT, low to high). Three passes in a row end the auction, and the last bid is the <strong>contract</strong>. If all four pass, the cards are redealt.</p>"),
            ("Declarer and dummy", "<p>The <strong>declarer</strong> is the partner who first named the contract's strain, not necessarily the last to bid. The player on declarer's left leads, then the <strong>dummy</strong> (declarer's partner) lays their hand face up, and declarer plays both hands.</p>"),
            ("The play", "<p>Follow the suit led if you can, or play any card. The highest trump wins, or else the highest card of the suit led. In No Trump there are no trumps.</p>"),
            ("Scoring", "<ul><li>Make the contract and your side scores per trick bid: <strong>20</strong> in ♣ ♦, <strong>30</strong> in ♥ ♠, and in No Trump <strong>40</strong> for the first trick then 30.</li><li>Reaching 100 in one contract (3NT, 4♥, 4♠, 5♣, 5♦) earns a <strong>game bonus</strong>. 12 or 13 tricks bid and made are <strong>slams</strong>.</li><li>Fall short and the defenders score for each trick you're down. Doubles and vulnerability raise the stakes.</li></ul>"),
            ("Chicago", "<p>The app scores bridge as <strong>Chicago</strong>: four deals with nobody vulnerable, then the dealer's side twice, then both. Most points wins.</p>"),
        ],
        "tips": [
            "Turn on guided bidding in Settings: the app highlights the suggested call, and you can press and hold any call to see what it means.",
            "As declarer, count your sure winners before playing to trick one.",
            "With trumps, draw the opponents' trumps early unless you need them to ruff in dummy.",
        ],
        "faq": [
            ("Do I need a partner to play bridge?", "Not in our app. You play against three computer opponents, and you play your partner's hand whenever your side declares."),
            ("Which bidding system does the app use?", "Standard American (SAYC) for all four players."),
        ],
    },
    {
        "slug": "whist",
        "name": "Whist",
        "icon": "whist",
        "accent": "#1d6fb8",
        "pkg": "com.datgames.whist",
        "ios": "6443517269",
        "kind": "Partnership · Classic tricks",
        "lede": "Whist is the ancestor of Spades and Bridge, and the purest trick-taking game there is. No bidding: a turned-up card sets trump, and your partnership simply tries to win more than six tricks.",
        "facts": ["4 players in 2 teams", "52-card deck", "No bidding", "Short whist to 5"],
        "glance": [
            "The dealer's last card sets trump.",
            "Follow the suit led if you can.",
            "Highest trump, or highest of the suit led, wins.",
            "Each trick over six scores 1 point.",
            "First team to 5 wins.",
        ],
        "sections": [
            ("Setup and trump", "<p>Deal all 52 cards, 13 each. You and North are partners against East and West. The dealer's last card is turned face up: <strong>its suit is trumps</strong> for the hand. That card stays in the dealer's hand and is played normally.</p>"),
            ("Playing a trick", "<p>The player on the dealer's left leads the first trick, and play goes clockwise. Follow the suit led if you can; if you can't, play anything. The highest trump wins the trick, or the highest card of the suit led if no trump was played.</p>"),
            ("Scoring", "<p>The first six tricks score nothing. The side taking more than six scores <strong>one point for each trick above six</strong> (the “odd tricks”).</p>"),
            ("Winning", "<p>The first partnership to the target wins. Short whist is <strong>5</strong>; you can change the target in Settings.</p>"),
        ],
        "tips": [
            "Lead from your longest suit to set up winners for later.",
            "Second hand low, third hand high: a classic rule that still works.",
            "Watch the up-card: you know one of the dealer's trumps for certain.",
        ],
        "faq": [
            ("Is there bidding in Whist?", "No. The turned-up card decides trumps every hand."),
        ],
    },
    {
        "slug": "bray",
        "name": "Bray",
        "icon": "bray",
        "accent": "#df4a44",
        "pkg": "com.datgames.bray",
        "ios": "1607650705",
        "kind": "Hearts family",
        "lede": "Bray is a fast member of the Hearts family. No passing and no 2♣ rule; just dodge hearts and the Queen of Spades, or take no tricks at all for a big bonus.",
        "facts": ["4 players, each on their own", "52-card deck", "No trump suit", "Game to 100"],
        "glance": [
            "Each heart = 1 point. Q♠ = 12.",
            "Lead any card, hearts included.",
            "Follow suit; highest of the led suit wins.",
            "Take no tricks in a deal: −12 bonus.",
            "Lowest score when someone hits 100 wins.",
        ],
        "sections": [
            ("Setup", "<p>Deal 13 cards to each player. Cards rank A K Q J 10 … 2. There is no trump suit, and every player is on their own.</p>"),
            ("Playing a trick", "<p>There is no passing. The leader of each trick may play <strong>any card</strong>: there is no 2♣ rule, and hearts may be led at any time. Follow the led suit if you can; if not, play any card. The highest card of the led suit wins and leads next.</p>"),
            ("Penalty points", "<p>Each <strong>heart is 1 point</strong> and the <strong>Q♠ is 12</strong>, so there are 25 penalty points in every deal. Points are bad: aim to take as few as possible.</p>"),
            ("Zero-trick bonus", "<p>Take <strong>no tricks at all</strong> in a deal and you earn a <strong>−12</strong> bonus. Slipping under every trick can be as good as dodging the penalty cards.</p>"),
            ("Winning", "<p>Play continues until someone reaches <strong>100</strong>. The player with the <strong>lowest</strong> score at that moment wins.</p>"),
        ],
        "tips": [
            "Low cards are gold: they let you duck tricks and chase the −12 bonus.",
            "With no 2♣ rule, an early heart lead can catch players who were saving high hearts.",
            "Keep track of the Q♠; once it's gone, high spades are safe to play.",
        ],
        "faq": [
            ("How is Bray different from Hearts?", "No passing, no 2♣ lead rule, hearts can be led any time, the Q♠ is 12 instead of 13, and a deal with zero tricks earns −12."),
        ],
    },
    {
        "slug": "snake-uncoil",
        "name": "Snake Uncoil",
        "icon": "snakeuncoil",
        "accent": "#5b3fc4",
        "pkg": "com.datgames.snakeuncoil",
        "ios": "6826481395",
        "kind": "Logic puzzle",
        "lede": "Snake Uncoil is a calm logic puzzle with one question: which snake can move next? Tap a snake and it slides straight out the way its head faces. Free them all to clear the board.",
        "facts": ["600 levels", "12 worlds", "Daily challenge", "No timers"],
        "glance": [
            "Tap a snake to slide it out the way it faces.",
            "It only escapes if nothing blocks its path.",
            "A blocked snake bumps back and costs a heart.",
            "You have three hearts per level.",
            "Clear every snake to win.",
        ],
        "sections": [
            ("The goal", "<p>Each level is a board of tangled snakes. Clear every snake off the board to win.</p>"),
            ("Moving snakes", "<p>Tap a snake and it slides straight out in the direction its <strong>head</strong> faces. It can only escape if <strong>nothing blocks its path</strong> to the edge. Tap a blocked snake and it bumps back, costing one of your <strong>three hearts</strong>.</p>"),
            ("Stars and hints", "<p>Clear a board in fewer taps for <strong>three stars</strong>. Stuck? A hint shows you a snake that can move. There are no timers, so think as long as you like.</p>"),
            ("Twists", "<p>As you progress, new mechanics appear: sleepy snakes, locked gates and golden key snakes, tall grass, tunnels, frozen and vine-tied snakes, ghost snakes, crystal mirrors that bend the path, and more.</p>"),
            ("Daily challenge", "<p>A fresh puzzle every day, from an easy Monday to an expert Sunday. Keep your streak going.</p>"),
        ],
        "tips": [
            "Start from the edges: snakes pointing outward near the border are usually free.",
            "Before tapping, trace the line from the head to the edge.",
            "On big boards, pinch or tap Zoom to check for hidden blockers.",
        ],
        "faq": [
            ("Is every level solvable?", "Yes. Every board has a solution."),
            ("Can I play offline?", "Yes. Gameplay works without a connection."),
        ],
    },
]

PLAY_SVG = '<svg aria-hidden="true"><use href="#i-play"/></svg>'
APPLE_SVG = '<svg aria-hidden="true"><use href="#i-apple"/></svg>'
SPRITE = """    <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
      <symbol id="i-play" viewBox="0 0 24 24"><path fill="#00D2FF" d="M3.9 1.5 14 12 3.9 22.5c-.5-.3-.9-.9-.9-1.6V3.1c0-.7.4-1.3.9-1.6z"/><path fill="#FFCE00" d="M18.6 8.7 14 12l-3.1-3.1 6.6-3.8c.4.2.8.5 1.1.9z"/><path fill="#00F076" d="M3.9 1.5c.2-.1.5-.2.8-.2.3 0 .7.1 1 .3l9.2 5.3L11.9 10 3.9 1.5z"/><path fill="#FF3A44" d="M3.9 22.5 11.9 14l3 3.1-9.2 5.3c-.3.2-.7.3-1 .3-.3 0-.6-.1-.8-.2z"/></symbol>
      <symbol id="i-apple" viewBox="0 0 24 24"><path fill="currentColor" d="M16.4 12.7c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.6.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.4 0-2.8.8-3.5 2.1-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.5 2.2 2.6 2.1 1-.04 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.6 1.1-.02 1.8-1 2.5-2 .8-1.2 1.1-2.3 1.1-2.4-.02-.01-2.1-.8-2.1-3.1zM14.3 5.8c.6-.7 1-1.7.9-2.7-.8.03-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.5.9.07 1.8-.5 2.5-1.1z"/></symbol>
    </svg>"""


def head(title: str, desc: str, path: str, ld: list[dict]) -> str:
    ld_json = "\n".join(
        f'    <script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld
    )
    return f"""<!doctype html>
<html lang="en">
  <head>
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=AW-7662884847"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){{dataLayer.push(arguments);}}
      gtag('js', new Date());
      gtag('config', 'AW-7662884847');
      gtag('config', 'G-677P55P83T');
      document.addEventListener('click', function (e) {{
        var a = e.target.closest && e.target.closest('a');
        if (!a) return;
        var h = a.href || '';
        if (a.classList.contains('store-btn') || /play\.google\.com|apps\.apple\.com/.test(h)) {{
          gtag('event', 'store_click', {{ store: /apple/.test(h) ? 'app_store' : 'google_play', page_path: location.pathname, link_url: h }});
        }} else if (/play-big|play-card-btn|play-tile|phc-/.test(a.className) || /^\/play\//.test(a.getAttribute('href') || '')) {{
          gtag('event', 'play_click', {{ page_path: location.pathname, link_url: h }});
        }}
      }});
    </script>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{html.escape(title)}</title>
    <meta name="description" content="{html.escape(desc)}">
    <link rel="canonical" href="{SITE}{path}">
    <meta name="theme-color" content="#06251f">
    <meta property="og:title" content="{html.escape(title)}">
    <meta property="og:description" content="{html.escape(desc)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="{SITE}{path}">
    <link rel="icon" type="image/png" href="/assets/img/icons/favicon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/styles.css?v=3">
    <script defer src="/assets/main.js"></script>
{ld_json}
  </head>
  <body>
{SPRITE}
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header is-solid" data-site-header data-force-solid>
      <a class="brand" href="/" aria-label="DAT Games Studio home">
        <span class="brand-mark" aria-hidden="true">D</span>
        <span>
          <strong>DAT Games</strong>
          <small>Studio</small>
        </span>
      </a>
      <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav">
        <span></span>
        <span></span>
        <span></span>
        <span class="sr-only">Menu</span>
      </button>
      <nav class="site-nav" id="site-nav" data-site-nav>
        <a href="/#games">Games</a>
        <a href="/play/">Play online</a>
        <a href="/how-to-play/">How to play</a>
        <a href="/#studio">Studio</a>
        <a href="/#contact">Contact</a>
        <a class="nav-cta" href="/#download">Download</a>
      </nav>
    </header>
"""


FOOT = """    <footer class="site-footer">
      <div>
        <strong>DAT Games Studio</strong>
        <span>Free card games &amp; puzzles for Android and iPhone.</span>
      </div>
      <nav aria-label="Footer">
        <a href="/play/">Play online</a>
        <a href="/how-to-play/">How to play</a>
        <a href="/privacy-policy/">Privacy Policy</a>
        <a href="https://play.google.com/store/apps/developer?id=DAT+Games&amp;utm_source=website&amp;utm_medium=organic&amp;utm_campaign=how_to_play&amp;utm_content=footer" rel="noopener">Google Play</a>
        <a href="https://apps.apple.com/us/developer/debarghya-majumdar/id1606221938" rel="noopener">App Store</a>
        <a href="https://www.facebook.com/DATMobileGames" rel="noopener">Facebook</a>
        <a href="https://www.instagram.com/datgamesstudio/" rel="noopener">Instagram</a>
      </nav>
    </footer>
  </body>
</html>
"""


def short(g: dict) -> str:
    return g.get("short", g["name"])


def store_row(g: dict) -> str:
    esc_name = html.escape(short(g))
    play = PLAY.format(pkg=g["pkg"], slug=g["slug"]).replace("&", "&amp;")
    out = [f'<a class="store-btn" href="{play}" rel="noopener" aria-label="{esc_name} on Google Play">{PLAY_SVG}<span><small>Get it on</small>Google Play</span></a>']
    if g["ios"]:
        out.append(f'<a class="store-btn" href="{APPLE.format(id=g["ios"])}" rel="noopener" aria-label="{esc_name} on the App Store">{APPLE_SVG}<span><small>Download on the</small>App Store</span></a>')
    else:
        out.append(f'<span class="store-btn is-soon">{APPLE_SVG}<span><small>iPhone</small>Coming soon</span></span>')
    return '<div class="store-row">' + "".join(out) + "</div>"


WEB_PLAY = {"callbreak", "twenty-nine", "tarneeb", "hearts", "hokm", "spades", "whist", "bray"}
# Order and one-line pitch for the /play/ hub and the homepage band.
PLAY_ORDER = ["callbreak", "twenty-nine", "hearts", "spades", "bray", "tarneeb", "hokm", "whist"]
PLAY_TAG = {
    "callbreak": "Spades are always trump",
    "twenty-nine": "Bid, hidden trump, partners",
    "hearts": "Dodge the hearts and the Queen",
    "spades": "The partnership bidding classic",
    "bray": "Hearts, Bengali style",
    "tarneeb": "Arabic partnership bidding",
    "hokm": "The Persian trump caller",
    "whist": "Pure trick-taking, no bidding",
}


def play_button(g: dict, cls: str = "play-big") -> str:
    if g["slug"] not in WEB_PLAY:
        return ""
    return (
        f'<a class="{cls}" href="/play/{g["slug"]}/"><span class="pb-icon" aria-hidden="true">▶</span>'
        f'<span><strong>Play {html.escape(short(g))} now</strong><small>Free in your browser · no download</small></span></a>'
    )


def web_play(g: dict) -> str:
    if g["slug"] not in WEB_PLAY:
        return ""
    return f'<a class="web-play" href="/play/{g["slug"]}/">▶ Play in your browser</a>'


def slugify(text: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in text.lower()).strip("-").replace("--", "-")


def game_page(g: dict) -> str:
    name, s = g["name"], short(g)
    path = f"/how-to-play/{g['slug']}/"
    title = f"How to Play {s}: Rules, {'Levels & Tips' if g['slug'] == 'snake-uncoil' else 'Scoring & Tips'} | DAT Games"
    desc = f"Learn how to play {s}: setup, rules, scoring and winning tips, explained simply. Then play {s} free on Android and iPhone."
    toc = "".join(f'<li><a href="#{slugify(h)}">{html.escape(h)}</a></li>' for h, _ in g["sections"])
    sections = "\n".join(
        f'          <section id="{slugify(h)}"><h2>{html.escape(h)}</h2>{body}</section>' for h, body in g["sections"]
    )
    glance = "".join(f"<li>{html.escape(x)}</li>" for x in g["glance"])
    facts = "".join(f"<li>{html.escape(x)}</li>" for x in g["facts"])
    tips = "".join(f"<li>{html.escape(x)}</li>" for x in g["tips"])
    faq = "".join(
        f"<details><summary>{html.escape(q)}</summary><p>{html.escape(a)}</p></details>" for q, a in g["faq"]
    )
    others = "".join(
        f'<a href="/how-to-play/{o["slug"]}/"><img src="/assets/img/icons/{o["icon"]}.png" alt="" width="40" height="40" loading="lazy"><span>{html.escape(short(o))}</span></a>'
        for o in GAMES
        if o is not g
    )
    ld = [
        {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": f"How to Play {s}",
            "description": desc,
            "dateModified": UPDATED,
            "author": {"@type": "Organization", "name": "DAT Games Studio"},
            "publisher": {"@type": "Organization", "name": "DAT Games Studio", "logo": {"@type": "ImageObject", "url": f"{SITE}/assets/img/icons/favicon.png"}},
            "image": f"{SITE}/assets/img/icons/{g['icon']}.png",
            "mainEntityOfPage": f"{SITE}{path}",
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
                {"@type": "ListItem", "position": 2, "name": "How to play", "item": f"{SITE}/how-to-play/"},
                {"@type": "ListItem", "position": 3, "name": s, "item": f"{SITE}{path}"},
            ],
        },
        {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in g["faq"]
            ],
        },
    ]
    return head(title, desc, path, ld) + f"""
    <main id="main" class="guide-page" style="--accent:{g['accent']}">
      <section class="guide-hero">
        <div class="guide-hero-inner">
          <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/how-to-play/">How to play</a><span aria-hidden="true">/</span><span aria-current="page">{html.escape(s)}</span></nav>
          <div class="guide-title">
            <img src="/assets/img/icons/{g['icon']}.png" alt="" width="84" height="84">
            <div>
              <p class="eyebrow">{html.escape(g['kind'])}</p>
              <h1>How to play {html.escape(name)}</h1>
            </div>
          </div>
          <p class="guide-lede">{html.escape(g['lede'])}</p>
          {play_button(g)}
          <ul class="guide-facts">{facts}</ul>
        </div>
      </section>

      <div class="guide-body">
        <aside class="guide-side">
          <div class="glance">
            <h2>Rules at a glance</h2>
            <ol>{glance}</ol>
          </div>
          <nav class="guide-toc" aria-label="On this page">
            <p>On this page</p>
            <ol>{toc}<li><a href="#tips">Tips</a></li><li><a href="#faq">FAQ</a></li></ol>
          </nav>
          <div class="side-cta">
            <img src="/assets/img/icons/{g['icon']}.png" alt="" width="48" height="48" loading="lazy">
            <p><strong>Play {html.escape(s)} free</strong>Offline, against smart AI.</p>
            {web_play(g)}
            {store_row(g)}
          </div>
        </aside>

        <article class="guide-content">
{sections}
          <section id="tips" class="tips"><h2>Tips to win</h2><ul>{tips}</ul></section>
          <section id="faq"><h2>FAQ</h2>{faq}</section>
          <section class="guide-cta">
            <img src="/assets/img/icons/{g['icon']}.png" alt="" width="64" height="64" loading="lazy">
            <div>
              <h2>Ready to play {html.escape(s)}?</h2>
              <p>Free, offline, no signup. Learn the rest at the table with built-in hints.</p>
              {play_button(g)}
              {store_row(g)}
            </div>
          </section>
        </article>
      </div>

      <section class="guide-more">
        <div class="section-inner">
          <h2>More guides</h2>
          <div class="guide-more-row">{others}</div>
        </div>
      </section>
    </main>
""" + FOOT


def hub_page() -> str:
    path = "/how-to-play/"
    title = "How to Play Card Games: Callbreak, 29, Tarneeb, Hokm, Bridge & More | DAT Games"
    desc = "Simple, accurate rules for Callbreak, 29, Tarneeb, Hokm, Hearts, Spades, Bridge, Whist, Bray and the Snake Uncoil puzzle. Learn in minutes, then play free."
    cards = "\n".join(
        f"""          <a class="hub-card" href="/how-to-play/{g['slug']}/" style="--accent:{g['accent']}">
            <img src="/assets/img/icons/{g['icon']}.png" alt="" width="64" height="64" loading="lazy">
            <span class="hub-kind">{html.escape(g['kind'])}</span>
            <h2>{html.escape(g['name'])}</h2>
            <p>{html.escape(g['glance'][0])} {html.escape(g['glance'][1])}</p>
            <span class="hub-go">Read the rules <span aria-hidden="true">→</span></span>
          </a>"""
        for g in GAMES
    )
    ld = [
        {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": "How to play",
            "url": f"{SITE}{path}",
            "hasPart": [{"@type": "Article", "headline": f"How to Play {short(g)}", "url": f"{SITE}/how-to-play/{g['slug']}/"} for g in GAMES],
        }
    ]
    return head(title, desc, path, ld) + f"""
    <main id="main" class="guide-page">
      <section class="guide-hero hub-hero">
        <div class="guide-hero-inner">
          <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><span aria-current="page">How to play</span></nav>
          <p class="eyebrow">Rules &amp; guides</p>
          <h1>How to play</h1>
          <p class="guide-lede">Clear, short rules for every DAT Games title, written to match exactly how each game plays in our apps. Pick a game, learn it in a few minutes, then deal yourself in.</p>
        </div>
      </section>
      <section class="section section-light">
        <div class="section-inner hub-grid">
{cards}
        </div>
      </section>
    </main>
""" + FOOT


def play_hub_page() -> str:
    path = "/play/"
    title = "Play Card Games Online Free: Callbreak, 29, Hearts, Spades & More | DAT Games"
    desc = "Play Callbreak, 29, Hearts, Spades, Bray, Tarneeb, Hokm and Whist free in your browser against computer opponents. No download, no signup."
    by_slug = {g["slug"]: g for g in GAMES}
    tiles = "\n".join(
        f"""          <article class="play-hub-card" style="--accent:{g['accent']}">
            <a class="phc-main" href="/play/{g['slug']}/">
              <img src="/assets/img/icons/{g['icon']}.png" alt="" width="72" height="72" loading="lazy">
              <span class="hub-kind">{html.escape(g['kind'])}</span>
              <h2>{html.escape(g['name'])}</h2>
              <p>{html.escape(PLAY_TAG[g['slug']])}</p>
              <span class="phc-cta"><span aria-hidden="true">▶</span> Play now</span>
            </a>
            <a class="phc-rules" href="/how-to-play/{g['slug']}/">How to play {html.escape(short(g))} <span aria-hidden="true">→</span></a>
          </article>"""
        for g in (by_slug[x] for x in PLAY_ORDER)
    )
    ld = [
        {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": "Play card games online",
            "url": f"{SITE}{path}",
            "hasPart": [{"@type": "VideoGame", "name": short(by_slug[x]), "url": f"{SITE}/play/{x}/"} for x in PLAY_ORDER],
        }
    ]
    return head(title, desc, path, ld) + f"""
    <main id="main" class="guide-page">
      <section class="guide-hero hub-hero">
        <div class="guide-hero-inner">
          <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><span aria-current="page">Play online</span></nav>
          <p class="eyebrow">Free · no download · no signup</p>
          <h1>Play card games in your browser</h1>
          <p class="guide-lede">Deal yourself in right now against computer opponents. Each game plays by the same rules as our apps; when you want stats, lessons and a stronger computer, the full app is one tap away.</p>
        </div>
      </section>
      <section class="section section-light">
        <div class="section-inner play-hub-grid">
{tiles}
        </div>
      </section>
    </main>
""" + FOOT


def main() -> None:
    out = ROOT / "how-to-play"
    out.mkdir(exist_ok=True)
    (out / "index.html").write_text(hub_page())
    for g in GAMES:
        d = out / g["slug"]
        d.mkdir(exist_ok=True)
        (d / "index.html").write_text(game_page(g))
    (ROOT / "play" / "index.html").write_text(play_hub_page())
    print(f"wrote hub + {len(GAMES)} guides to {out}, and /play/")


if __name__ == "__main__":
    main()
