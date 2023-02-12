#!/bin/sh
# Reset Parallels Desktop's trial and generate a casual email address to register a new user
sudo rm /private/var/root/Library/Preferences/com.parallels.desktop.plist /Library/Preferences/Parallels/licenses.json
jot -w chiazy94@gmail.com -r 1