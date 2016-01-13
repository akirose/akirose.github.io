$(document).ready(function(){
	/* Extend jQuery */
	(function($, undefined) {
		$.extend($, {
			overlay : function() {
				var docHeight = $(document).height();
				
				// remove before create
				$("div#overlay").remove();
				
				// create element to body
				$("<div></div>", { id : 'overlay' }).appendTo('body');
				
				$("div#overlay")
					.height(docHeight)
					.css({
						'opacity' : 0.4,
						'position' : 'absolute',
						'top' : 0,
						'left' : 0,
						'background-color' : 'black',
						'width' : '100%',
						'z-index' : 9999
					});
				
				$(window).bind('resize', function() {
					console.log("?");
					$.overlay();
				});
			}
		});
		
		$.extend($.fn, {
			notify : function(options) {
				var autoclose = -1, float = false, message = "";
				
				if(typeof options === "string") {
					message = options;
				}
				
				if(typeof options === "object") {
					autoclose = typeof options.closeAfter === "number" ? options.closeAfter : -1;
					message = typeof options.message === "string" ? options.message : "";
					float = typeof options.float === "boolean" ? options.float : false;
				}

				var element = $("<div></div>", { id : "notification" })
					.text(message)
					.css({
						'font': '11px Tahoma',
						'opacity': 0.9,
						'position': 'absolute',
						'top': 0,
						'left': 0,
						'background-color': '#f2fd91',
						'width': '100%',
						'z-index': 9999,
						'padding': '8px 10px 8px 10px'
					})
					.appendTo(this);
				
				if(autoclose > 0) {
					setTimeout(function() { element.fadeOut(500); }, autoclose);
				}
				
				if(float) {
					$(window).bind("scroll", function(event) {
						element.css('top', $('body').scrollTop());
					});
				}
				
				return element;
			}
		});
	})(jQuery);;
	
	if($.browser.msie === true && $.browser.version < 7) {
		$("body").notify( {
			float: true,
			closeAfter: 5000,
			message: "현재 사용중인 Microsoft Internet Explorer " + $.browser.version + "의 업그레이드를 권장합니다."
		});
	}
	
});