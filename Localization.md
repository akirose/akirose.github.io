---
layout: page
title: Localization
category: Localization
permalink: /localization/
---

<div id="archives">
{% for post in site.categories[page.category] %}
	<article class="archive-item">
		<h3><a href="{{ post.url }}">{{ post.title }}</a>&nbsp;<small style="font-size:0.7em">-- Written on {{ post.date | date: "%B %e, %Y" }}</small></h3>
	</article>
{% endfor %}
</div>