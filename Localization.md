---
layout: page
title: Localization
category: Localization
permalink: /localization/
---
> 개인적인 작업물로 공유는 하지 않으며, 관련 문의도 받지 않습니다.
{:class="info"}
<div id="archives">
{% for post in site.categories[page.category] %}
	<article class="archive-item">
		<h3><a href="{{ post.url }}">{{ post.title }}</a>&nbsp;<small style="font-size:0.7em">-- Written on {{ post.date | date: "%B %e, %Y" }}</small></h3>
	</article>
{% endfor %}
</div>