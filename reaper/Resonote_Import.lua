-- Resonote_Import.lua — REAPER side of the Resonote Bridge
--
-- Finds the newest resonote_*.mid exported from the Resonote app
-- (browser downloads land in Downloads; batch tools write to
-- D:\Guitar\ResonoteBridge\outbox) and inserts it at the edit cursor
-- on the selected track (or a new track if none is selected).
--
-- Install (one time): Actions > Show action list > New action >
-- Load ReaScript > pick this file. Assign a shortcut like Ctrl+Alt+I.
--
-- The exported .mid embeds tempo + time signature; whether REAPER
-- adopts them is controlled by the import prompt / MIDI preferences.

local sep = package.config:sub(1, 1)

local function downloads_dir()
  local prof = os.getenv("USERPROFILE")
  if prof then return prof .. sep .. "Downloads" end
  return nil
end

local FOLDERS = {
  downloads_dir(),
  "D:\\Guitar\\ResonoteBridge\\outbox",
  "D:\\Guitar\\ResonoteBridge",
}

-- Collect resonote_*.mid across the folders, keeping the embedded
-- timestamp (resonote_<kind>_YYYYMMDD_HHMMSS.mid) as the sort key so
-- "newest export" wins regardless of which folder or kind it is.
local candidates = {}
for _, dir in ipairs(FOLDERS) do
  if dir then
    local i = 0
    while true do
      local f = reaper.EnumerateFiles(dir, i)
      if not f then break end
      local lower = f:lower()
      if lower:match("^resonote_.*%.mid$") then
        local stamp = lower:match("(%d%d%d%d%d%d%d%d_%d%d%d%d%d%d)") or "00000000_000000"
        candidates[#candidates + 1] = { path = dir .. sep .. f, name = f, stamp = stamp }
      end
      i = i + 1
    end
  end
end

if #candidates == 0 then
  reaper.ShowMessageBox(
    "No resonote_*.mid files found.\n\nExport one from the Resonote app first (REAPER Bridge / Export MIDI buttons), then run this again.\n\nSearched:\n - Downloads\n - D:\\Guitar\\ResonoteBridge",
    "Resonote Import", 0)
  return
end

table.sort(candidates, function(a, b)
  if a.stamp ~= b.stamp then return a.stamp > b.stamp end
  return a.name > b.name
end)
local newest = candidates[1]

reaper.Undo_BeginBlock()
-- mode 0 inserts at the edit cursor on the current/selected track;
-- with no selected track, land it on a fresh track instead (mode 1).
local mode = (reaper.CountSelectedTracks(0) > 0) and 0 or 1
local ok = reaper.InsertMedia(newest.path, mode)
reaper.Undo_EndBlock("Resonote import: " .. newest.name, -1)

if ok ~= nil then
  reaper.UpdateArrange()
end
