# Daily notes

This page is for the person who writes the notes. It explains the note of each
day and the calendar in the sidebar that opens it.

## The note of a day

Each day has one note. By default its name is the date, for example
`2026-09-24`, and it is in the folder **Daily notes**. You can change the folder
and the name in the settings. It is an ordinary note: you edit, search, link,
export and delete it like any other note.

If you rename the note or move it to another folder, it is no longer the note
of its day. The next time you open that day, a new note is made.

## The calendar

The calendar is in the sidebar, below the folders. It shows one month. A day
with a note has a dot under its number, and today has an edge around it.

- Select a day to open its note. If the day has no note, a new one is made.
- Select the calendar icon to open the note of today.
- Select the arrows to go to the previous or the next month.
- Select the name of the month to hide the month or show it again.
- With the keyboard, the arrow keys move one day or one week, **Home** and
  **End** move to the start and the end of the week, and **Page Up** and **Page
  Down** move one month. Hold **Shift** with **Page Up** or **Page Down** to
  move one year. Press **Enter** to open the note of the selected day.

You can also open the command palette and select **Open today's note**. The
date comes from the clock of your device.

## Settings

Open **Settings** and go to **Daily notes**. The settings apply to the open
workspace, and they follow your account to every device.

- **Template** is a note whose text a new daily note starts with. The text is
  copied once, when the daily note is made. A later change to the template
  does not change the daily notes that already exist. Select **No template**
  to start each daily note empty.
- **Open today's note when the app opens** opens the note of today each time
  the app starts on the note list. If you open the app with the address of a
  note or of another page, that page opens instead.

- In the template, a placeholder in double braces is filled when the daily
  note is made. See [Placeholders in a template](#placeholders-in-a-template).
- **Folder** is the folder that holds the daily notes. Leave it empty to keep
  them at the top of the workspace.
- **Name format** is the name of each daily note, written with date tokens.
  A new folder or format applies when you leave the field or press Enter. The
  line under the fields shows the name of today's note as you type.

### Date tokens

The name format uses the same tokens as Obsidian.

| Token  | Example for Friday 25 September 2026 |
| ------ | ------------------------------------ |
| `YYYY` | `2026`                               |
| `YY`   | `26`                                 |
| `Q`    | `3`, the quarter                     |
| `MMMM` | `September`                          |
| `MMM`  | `Sep`                                |
| `MM`   | `09`                                 |
| `M`    | `9`                                  |
| `DD`   | `25`                                 |
| `D`    | `25`                                 |
| `Do`   | `25th`                               |
| `dddd` | `Friday`                             |
| `ddd`  | `Fri`                                |
| `dd`   | `Fr`                                 |
| `d`    | `5`, where Sunday is `0`             |

- A `/` makes a folder. For example, `YYYY/MM/YYYY-MM-DD dddd` puts the note of
  today at `2026/09/2026-09-25 Friday` in the daily notes folder.
- Put other text in square brackets, for example `[Journal] YYYY-MM-DD`. A
  letter outside brackets can be a token: `D` in `Day` writes the day.
- The format must have a year, a month and a day of the month.
- The names of months and days are in English on every device.

### Placeholders in a template

Write these in the template note. Each one is filled once, when a new daily
note is made, with the date of that note.

| Placeholder                    | Example for the note of 3 September 2026 |
| ------------------------------ | ---------------------------------------- |
| `{{date}}`                     | `2026-09-03`                             |
| `{{date:dddd, Do MMMM YYYY}}`  | `Thursday, 3rd September 2026`           |
| `{{dddd}}` or `{{YYYY-MM-DD}}` | `Thursday` or `2026-09-03`               |
| `{{title}}`                    | the name of the new note                 |

- After `date:`, use the same date tokens as the name format.
- A placeholder that the app does not know stays as you wrote it.
- The template note itself keeps its placeholders. Only the new daily note
  gets the filled text.

If you change the folder or the format, the notes you already have stay where
they are. The calendar marks only the notes that have the new name.

If you move the template note to Trash, a new daily note starts empty. When you
restore the template, it is the template again.

## With no connection

The settings that your device read last stay in use. If the template text is
not on your device and there is no connection, the daily note is not made.
Connect to the internet and try again.
