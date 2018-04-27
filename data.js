var data = [
    /*{
        type: "Maintenance",
        title: [
            "Test Block",
            "No actual maintenance, just testing"
        ],
        image: "maintenance.png",
        column: 0,
        timers: [
            {
                name: "Time",
                start: "Apr 1 2018, 14:00",
                end: "Apr 3 2018, 16:59"
            }
        ]
    },*/
    {
        type: "Event",
        title: [
            "Outclub and North Mountain and First Camp",
            "野クルと北の山と初キャンプ",
            "Yuru Camp event (Map Exploration)"
        ],
        image: "https://i.imgur.com/x7WRDbr.png",
        column: 0,
        autohide: true,
        timers: [
            {
                name: "Village area until Forest Area",
                start: "Apr 25 2018, 17:00",
                end: "May 7 2018, 13:59"
            },
            {
                name: "River area and afterwards",
                start: "Apr 27 2018, 17:00",
                end: "May 7 2018, 13:59"
            },
            {
                name: "Moss Cave (Boss/Super Boss)",
                start: "Apr 29 2018, 17:00",
                end: "May 7 2018, 13:59"
            },
            {
                name: "Secret Limestone Cave (EX Quest)",
                start: "May 1 2018, 17:00",
                end: "May 7 2018, 13:59"
            },
            {
                name: "Treasure Chest opening",
                start: "Apr 25 2018, 17:00",
                end: "May 14 2018, 13:59",
                info: "Includes period to exchange ticket for 4* Rin"
            }
        ]
    },
    {
        type: "Mission",
        title: [
            "Outclub and North Mountain and First Camp",
            "野クルと北の山と初キャンプ",
            "Yuru Camp event missions"
        ],
        image: "https://i.imgur.com/x7WRDbr.png",
        column: 0,
        autohide: true,
        timers: [
            {
                name: "Missions Set 1",
                start: "Apr 25 2018, 17:00",
                end: "May 7 2018, 23:59"
            },
            {
                name: "Missions Set 2",
                start: "Apr 28 2018, 0:00",
                end: "May 7 2018, 23:59"
            },
            {
                name: "Missions Set 3",
                start: "Apr 30 2018, 0:00",
                end: "May 7 2018, 23:59"
            }
        ]
    },
    {
        type: "Gacha",
        title: [
            "Outclub and North Mountain and First Camp",
            "野クルと北の山と初キャンプ",
            "Yuru Camp gacha"
        ],
        image: "https://i.imgur.com/x7WRDbr.png",
        column: 1,
        autohide: true,
        timers: [
            {
                name: "Rate-up for Rin, Nadeshiko, Chiaki and Aoi",
                start: "Apr 25 2018, 17:00",
                end: "May 9 2018, 11:59",
                info: "Doesn't include 4* Rin"
            }
        ]
    },
    {
        type: "Gacha",
        title: [
            "Warriors Characters Gacha",
            "Part 1: 5* Yuzuko, 5* Karen, 5* Sonya",
            "Part 2: 5* Tooru, 5* Yuu, 5* Merry"
        ],
        image: "https://i.imgur.com/trKxW6Q.png",
        column: 1,
        autohide: true,
        timers: [
            {
                name: "Part 1",
                start: "Apr 13 2018, 17:00",
                end: "Apr 20 2018, 16:59",
                info: "Featuring 5* Yuzuko, 5* Karen, 5* Sonya"
            },
            {
                name: "Part 2",
                start: "Apr 20 2018, 17:00",
                end: "Apr 27 2018, 16:59",
                info: "Featuring 5* Tooru, 5* Yuu, 5* Merry"
            }
        ]
    },
    {
        type: "Gacha",
        title: [
            "Mage Characters Gacha",
            "Part 1: 5* Aoba, 5* Maika",
            "Part 2: Unconfirmed"
        ],
        image: "https://i.imgur.com/jrReaMg.png",
        column: 1,
        autohide: true,
        timers: [
            {
                name: "Part 1",
                start: "Apr 27 2018, 17:00",
                end: "May 4 2018, 16:59",
                info: "Featuring 5* Aoba, 5* Maika"
            }
        ]
    },
    {
        type: "Event",
        title: [
            "'A Friend's Friend is also a Friend' Plan",
            "友達の友達は友達大作戦",
            "Slow Start Event"
        ],
        image: "https://i.imgur.com/CoA65zd.png",
        column: 1,
        autohide: true,
        timers: [
            {
                name: "Season 1",
                start: "Apr 11 2018, 17:00",
                end: "Apr 23 2018, 13:59",
                autohide: true
            },
            {
                name: "Season 2",
                start: "Apr 13 2018, 17:00",
                end: "Apr 23 2018, 13:59",
                autohide: true
            },
            {
                name: "Season 3",
                start: "Apr 15 2018, 17:00",
                end: "Apr 23 2018, 13:59",
                autohide: true
            },
            {
                name: "Boss Challenge Quest",
                start: "Apr 17 2018, 17:00",
                end: "Apr 23 2018, 13:59",
                autohide: true
            },
            {
                name: "Event Shop",
                start: "Apr 11 2018, 17:00",
                end: "Apr 30 2018, 13:59"
            }
        ]
    },
    {
        type: "Other",
        title: [
            "Golden Week bonus",
            "Special login bonus",
            "Special deals in the Trade Shop"
        ],
        image: "https://i.imgur.com/x7WRDbr.png",
        column: 2,
        autohide: true,
        timers: [
            {
                name: "Login Bonus",
                start: "Apr 27 2018, 0:00",
                end: "May 7 2018, 23:59",
                info: "Login every day for gems (1st day: 80 gems, 2nd day: 40 gems, 3rd~9th day: 20 gems, 10th day: 40 gems)",
                autohide: true
            },
            {
                name: "Trade Shop deals",
                start: "May 1 2018, 0:00",
                end: "May 9 2018, 23:59",
                info: "10x Summon Tickets (Price: 200 gems), 10x Golden Clocks (Price: 50 gems). Each can only be bough once.",
                autohide: true
            }
        ]
    },
    {
        type: "Other",
        title: [
            "Comic Girls Login bonus",
            "Receive 20 gems each day the anime airs",
            "Every thursday until June 21st"
        ],
        image: "https://i.imgur.com/JU39sPQ.png",
        column: 2,
        autohide: true,
        timers: [
            {
                name: "Episode 4",
                start: "Apr 26 2018, 0:00",
                end: "Apr 26 2018, 23:59",
                autohide: true
            },
            {
                name: "Episode 5",
                start: "May 3 2018, 0:00",
                end: "May 3 2018, 23:59",
                autohide: true
            },
            {
                name: "Episode 6",
                start: "May 10 2018, 0:00",
                end: "May 10 2018, 23:59",
                autohide: true
            },
            {
                name: "Episode 7",
                start: "May 17 2018, 0:00",
                end: "May 17 2018, 23:59",
                autohide: true
            },
            {
                name: "Episode 8",
                start: "May 24 2018, 0:00",
                end: "May 24 2018, 23:59",
                autohide: true
            },
            {
                name: "Episode 9",
                start: "May 31 2018, 0:00",
                end: "May 31 2018, 23:59",
                autohide: true
            },
            {
                name: "Episode 10",
                start: "Jun 7 2018, 0:00",
                end: "Jun 7 2018, 23:59",
                autohide: true
            },
            {
                name: "Episode 11",
                start: "Jun 14 2018, 0:00",
                end: "Jun 14 2018, 23:59",
                autohide: true
            },
            {
                name: "Episode 12",
                start: "Jun 21 2018, 0:00",
                end: "Jun 21 2018, 23:59",
                autohide: true
            }
        ]
    }
];
