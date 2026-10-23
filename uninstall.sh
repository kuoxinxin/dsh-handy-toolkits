#!/bin/sh
# Remove dsh-handy-toolkits from one DSH profile: drop its Loader entry from the
# patch layer and delete the installed copy. Quit DeepSeek Harness first.
set -eu

profile="${1:-desktop}"
dsh_home="${DSH_HOME:-$HOME/.dsh}"
profile_dir="$dsh_home/profiles/$profile"
patch_file="$profile_dir/cordis.patch.yml"
target="$profile_dir/plugins/dsh-handy-toolkits"

if [ ! -f "$patch_file" ]; then
	echo "dsh-handy-toolkits: no DSH profile at $profile_dir" >&2
	exit 1
fi

if grep -Fqx -e "    - id: dsh-handy-toolkits" "$patch_file"; then
	cp "$patch_file" "$patch_file.bak"
	awk '
		function flush() {
			if (state == 1) print held
			else if (state == 2) { print held; print "    - id: dsh-handy-toolkits" }
			state = 0
		}
		$0 == "- insert:" { flush(); held = $0; state = 1; next }
		state == 1 && $0 == "    - id: dsh-handy-toolkits" { state = 2; next }
		state == 2 && $0 == "      name: \"./plugins/dsh-handy-toolkits/lib/index.js\"" { state = 0; next }
		state != 0 { flush() }
		{ print }
		END { flush() }
	' "$patch_file.bak" >"$patch_file"
	echo "removed loader entry from $patch_file (backup: $patch_file.bak)"
else
	echo "no loader entry found in $patch_file"
fi

rm -rf "$target"
echo "removed $target"
