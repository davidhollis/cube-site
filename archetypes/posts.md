---
title: "{{ replace (replaceRE "^[0-9]+-" "" .Name) "-" " " | title }}"
date: {{ .Date }}
toc: false
draft: true
---

This is a post.

<!--more-->

This is the rest of the post