#!/bin/sh
# Install dsh-handy-toolkits into one DSH profile and enable it in that profile's
# patch layer. Quit DeepSeek Harness first: the app rewrites its profile files
# while it runs.
set -eu

profile="${1:-desktop}"
dsh_home="${DSH_HOME:-$HOME/.dsh}"
profile_dir="$dsh_home/profiles/$profile"
patch_file="$profile_dir/cordis.patch.yml"
target="$profile_dir/plugins/dsh-handy-toolkits"
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

if [ ! -f "$patch_file" ]; then
	echo "dsh-handy-toolkits: no DSH profile at $profile_dir" >&2
	echo "dsh-handy-toolkits: open DeepSeek Harness once to initialize it, then quit and retry." >&2
	exit 1
fi

if [ "$here" = "$target" ]; then
	echo "dsh-handy-toolkits: already installed at $target; nothing to copy." >&2
fi

mkdir -p "$profile_dir/plugins"
if [ "$here" != "$target" ]; then
	rm -rf "$target"
	cp -R "$here" "$target"
	# The checkout may be the git repo root; keep VCS and cache data out of the profile.
	rm -rf "$target/.git" "$target/node_modules" "$target/.npm-cache"
	echo "copied plugin to $target"
fi

# A patch entry only edits an existing row, so adding one uses the `insert`
# form: an id-less patch appends its list to the root tree.
entry_id="    - id: dsh-handy-toolkits"
entry_name='      name: "./plugins/dsh-handy-toolkits/lib/index.js"'

if grep -Fqx -e "$entry_id" "$patch_file"; then
	echo "loader entry already present in $patch_file"
else
	# Keep the YAML array valid even when the file ends without a newline.
	if [ -s "$patch_file" ] && [ -n "$(tail -c 1 "$patch_file")" ]; then
		printf '\n' >>"$patch_file"
	fi
	{
		printf '%s\n' "- insert:"
		printf '%s\n' "$entry_id"
		printf '%s\n' "$entry_name"
	} >>"$patch_file"
	echo "appended loader entry to $patch_file"
fi

echo
echo "Done. Reopen DeepSeek Harness, then press Cmd/Ctrl + Shift + = to zoom in,"
echo "Cmd/Ctrl + Shift + - to zoom out, and Cmd/Ctrl + Shift + 0 to reset."
