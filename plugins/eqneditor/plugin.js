/*
 CodeCogs Equation Editor plugin for CKEditor 4.

 Registers a toolbar button, a context-menu entry, and a double-click handler that all open the
 same dialog (dialogs/eqneditor.js), which embeds the shared EqEditor UI every adapter in
 fxPlugins uses. This file's only job is wiring CKEditor's plugin API to that dialog
 and making sure the EqEditor script/CSS are on the page before it needs them - script/CSS
 hosts default to fxtex.codecogs.com and can be overridden per CKEDITOR.replace() call with
 config.eqneditor_server (host only) or config.eqneditor_script_url/eqneditor_css_url (full
 URL - needed for a plain-HTTP local dev server, since the host-only default assumes https).

 Copyright (c) 2026 CodeCogs, Zyba Ltd. Released under the MIT licence - see LICENSE in this
 plugin's folder.
*/
( function () {
	'use strict';

	var DEFAULT_HOST = 'https://fxtex.codecogs.com';

	// One script/CSS load per URL no matter how many editor instances CKEDITOR.replace() is
	// called for on the page - CKEDITOR.scriptLoader.load() already dedupes network requests
	// for a URL it has seen before, but re-appending a <link> for the CSS on every init would
	// not, so both go through the same guard here for one consistent story.
	var scriptPromises = {};
	var loadedCss = {};

	function loadScriptOnce( url ) {
		if ( !scriptPromises[ url ] ) {
			// A single URL string (rather than an array) makes CKEDITOR.scriptLoader.load()
			// call its callback with a single "did it load" boolean, instead of the
			// (succeeded[], failed[]) pair it passes for an array of URLs.
			scriptPromises[ url ] = new Promise( function ( resolve, reject ) {
				CKEDITOR.scriptLoader.load( url, function ( succeeded ) {
					if ( succeeded ) resolve();
					else reject( new Error( 'CodeCogs Equation Editor: could not load ' + url ) );
				} );
			} );
		}
		return scriptPromises[ url ];
	}

	function loadCssOnce( url ) {
		if ( loadedCss[ url ] ) return;
		loadedCss[ url ] = true;

		var link = document.createElement( 'link' );
		link.rel = 'stylesheet';
		link.href = url;
		document.head.appendChild( link );
	}

	// Equation images are told apart from any other <img> on the page by their src - every
	// render URL this repo's EqEditor API produces matches (gif|svg|png).image?..., regardless
	// of adapter or rendering host.
	function isEquationImage( element ) {
		var src = element && element.getAttribute( 'src' );
		return !!src && /(gif|svg|png)\.image\?/.test( src );
	}

	function loadFxtexStyleOnce( url ) {
		if ( document.getElementById( 'fxtex-style' ) || document.querySelector( 'link[href="' + url + '"]' ) ) {
			return;
		}
		var link = document.createElement( 'link' );
		link.id = 'fxtex-style';
		link.rel = 'stylesheet';
		link.href = url;
		document.head.appendChild( link );
	}

	// Presentation MathML, plus the three non-"m" elements the converter can emit.
	// The $...$ or $$...$$ in `text` that `offset` is in or at the edge of, read as fxTeX Pro reads
	// it: $$ opens a display equation and a single $ an inline one, each closed by the same, and
	// \$ is a dollar sign, not a delimiter. Returns { start, end, latex, display }, or null.
	function texAround( text, offset ) {
		var i = 0;
		while ( i < text.length ) {
			var c = text.charAt( i );
			if ( c === '\\' ) { i += 2; continue; }
			if ( c !== '$' ) { i++; continue; }
			var display = text.charAt( i + 1 ) === '$', size = display ? 2 : 1, j = i + size;
			while ( j < text.length && !( text.charAt( j ) === '$' && ( !display || text.charAt( j + 1 ) === '$' ) ) ) {
				j += text.charAt( j ) === '\\' ? 2 : 1;
			}
			if ( j >= text.length ) return null;
			var end = j + size;
			if ( offset >= i && offset <= end ) {
				var latex = text.slice( i + size, j ).trim();
				return latex ? { start: i, end: end, latex: latex, display: display } : null;
			}
			i = end;
		}
		return null;
	}

	// The LaTeX equation at a point in the page's text (a text node and an offset in it, as a
	// selection gives), as texAround() describes, or null where there is none. Read across the
	// run of text nodes the point is in, as an editor often leaves one line's text in several.
	// Returns { tex: true, latex, display, text, start, end }, start and end being { node, offset }.
	function texAt( node, offset ) {
		if ( !node || node.nodeType !== 3 ) return null;
		var first = node, runs = [], text = '', at = 0;
		while ( first.previousSibling && first.previousSibling.nodeType === 3 ) first = first.previousSibling;
		for ( var n = first; n && n.nodeType === 3; n = n.nextSibling ) {
			if ( n === node ) at = text.length + offset;
			runs.push( { node: n, from: text.length } );
			text += n.data;
		}
		var found = texAround( text, at );
		if ( !found ) return null;
		// The node and offset `i` characters into the run - where a start or an end falls on the
		// join between two nodes, in the one the equation is in.
		var point = function ( i, isEnd ) {
			for ( var k = runs.length - 1; k > 0; k-- ) {
				if ( isEnd ? runs[ k ].from < i : runs[ k ].from <= i ) break;
			}
			return { node: runs[ k ].node, offset: i - runs[ k ].from };
		};
		return { tex: true, latex: found.latex, display: found.display, text: text.slice( found.start, found.end ),
			start: point( found.start, false ), end: point( found.end, true ) };
	}

	var MATHML_ELEMENTS = [
		'math', 'semantics', 'annotation', 'annotation-xml',
		'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace', 'mglyph',
		'mfrac', 'msqrt', 'mroot', 'mstyle', 'merror', 'mpadded', 'mphantom', 'menclose',
		'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover',
		'mmultiscripts', 'mprescripts', 'none',
		'mtable', 'mtr', 'mtd', 'mlabeledtr', 'maction'
	];

	// The SVG fxTeX Pro draws chemical structures (chemfig) and pictures (the picture environment)
	// with, inside the MathML, and the attributes it uses. Named one by one, unlike MathML's [*]:
	// SVG has event attributes (onload and the rest) that a content filter must not let through.
	// In lower case as well, as CKEditor reads attribute names in lower case (viewBox as viewbox).
	var SVG_ELEMENTS = [ 'svg', 'g', 'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse',
		'text', 'tspan', 'defs', 'use', 'title', 'desc' ];
	var SVG_ATTRIBUTES = [ 'xmlns', 'xmlns:xlink', 'version', 'viewBox', 'preserveAspectRatio', 'width', 'height',
		'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy', 'd', 'points', 'transform',
		'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
		'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity',
		'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor', 'dominant-baseline',
		'href', 'xlink:href', 'id', 'class', 'style', 'role', 'aria-label', 'aria-hidden', 'focusable', 'overflow',
		'viewbox', 'preserveaspectratio' ];

	// CKEditor's element table has no MathML, so saved MathML was taken apart when the content was
	// loaded - only its text was left, and the equation could not be opened again. Each MathML
	// element may hold text and any other, and the SVG of a chemical structure or a picture; <math>
	// may stand wherever inline content can.
	( function () {
		var dtd = CKEDITOR.dtd, children = { '#': 1 }, drawing = { '#': 1 };
		MATHML_ELEMENTS.forEach( function ( name ) { children[ name ] = 1; } );
		SVG_ELEMENTS.forEach( function ( name ) { children[ name ] = 1; drawing[ name ] = 1; } );
		MATHML_ELEMENTS.forEach( function ( name ) { dtd[ name ] = children; } );
		SVG_ELEMENTS.forEach( function ( name ) { dtd[ name ] = drawing; } );
		for ( var name in dtd ) {
			if ( name.charAt( 0 ) !== '$' && dtd[ name ] && dtd[ name ].span && !dtd[ name ].math ) dtd[ name ].math = 1;
		}
		dtd.$inline.math = 1;
	}() );

	CKEDITOR.plugins.add( 'eqneditor', {
		requires: [ 'dialog' ],
		lang: 'de,en,es,fr,it',
		icons: 'eqneditor',

		init: function ( editor ) {
			// The same for the content filter, which otherwise removes MathML, its spoken-text wrapper and
			// the equation image's class and referrerpolicy when the content is loaded.
			if ( editor.filter && editor.filter.allow ) {
				editor.filter.allow( MATHML_ELEMENTS.join( ' ' ) + '[*](*){*}', 'eqneditor' );
				// Not the namespaced names (xmlns:xlink, xlink:href): a colon makes the filter drop the whole rule.
				editor.filter.allow( SVG_ELEMENTS.join( ' ' ) + '[' + SVG_ATTRIBUTES.filter( function ( a ) {
					return a.indexOf( ':' ) === -1;
				} ).join( ',' ) + '](*){*}', 'eqneditor' );
				editor.filter.allow( 'span[role,aria-label,aria-hidden,lang](cc-math,fxtex); img[referrerpolicy](fxtex)', 'eqneditor' );
				editor.filter.allow( 'span[contenteditable](cc-math)', 'eqneditor' );
			}

			// Each MathML equation is one object while it is in the editor. The browser cannot
			// edit inside a <math> sensibly: Backspace after one pulled the following text into
			// the equation's last number instead of deleting it. Marked contenteditable="false"
			// (on the cc-math wrapper, else the <math>), it is selected and deleted whole. The
			// mark goes on as content is loaded and comes off as it is saved, so saved content
			// never carries it.
			var outerOf = function ( math ) {
				var p = math.parent;
				return p && p.name === 'span' && /(^|\s)cc-math(\s|$)/.test( p.attributes[ 'class' ] || '' ) ? p : math;
			};
			if ( editor.dataProcessor && editor.dataProcessor.dataFilter ) {
				editor.dataProcessor.dataFilter.addRules( {
					elements: { math: function ( el ) { outerOf( el ).attributes.contenteditable = 'false'; } }
				}, { applyToAll: true } );
				editor.dataProcessor.htmlFilter.addRules( {
					elements: { math: function ( el ) { delete outerOf( el ).attributes.contenteditable; } }
				}, { applyToAll: true } );
			}

			var host = editor.config.eqneditor_server || DEFAULT_HOST;
			// A bare host means https; a full origin (e.g. http://localhost:8010 for local development) is used as it is.
			var origin = /^https?:\/\//.test( host ) ? host.replace( /\/+$/, '' ) : 'https://' + host;
			var scriptUrl = editor.config.eqneditor_script_url || ( origin + '/fxeditor.api.min.js' );
			var cssUrl = editor.config.eqneditor_css_url || ( origin + '/fxeditor.css' );

			// fxtex.css styles inserted MathML. The dialog is on the outer page, where fxTeX Pro
			// (loaded by EqEditor.init() when the dialog first opens) adds those rules itself as
			// <style id="fxtex-style">, so that page is not given a copy. The content area is an
			// iframe that stylesheet never reaches, so it goes in there. An inline editor's
			// content is part of the page and needs it before the dialog has ever been opened:
			// there it is added under fxTeX Pro's id, which stops fxTeX Pro adding a second copy.
			var mathmlCssUrl = editor.config.eqneditor_mathml_css_url || ( origin + '/fxtex.css' );

			loadScriptOnce( scriptUrl ).catch( function ( err ) { console.error( err ); } );
			loadCssOnce( cssUrl );
			if ( editor.elementMode === CKEDITOR.ELEMENT_MODE_INLINE ) {
				loadFxtexStyleOnce( mathmlCssUrl );
			} else {
				editor.addContentsCss( mathmlCssUrl );
			}

			var lang = editor.lang.eqneditor;
			var commandName = 'eqneditorDialog';

			editor.addCommand( commandName, new CKEDITOR.dialogCommand( commandName, {
				allowedContent: 'img[src,alt]',
				requiredContent: 'img[src,alt]'
			} ) );

			CKEDITOR.dialog.add( commandName, this.path + 'dialogs/eqneditor.js' );

			editor.ui.addButton( 'EqnEditor', {
				label: lang.toolbar,
				command: commandName,
				icon: this.path + 'icons/eqneditor.png',
				toolbar: 'insert'
			} );

			if ( editor.contextMenu ) {
				editor.addMenuGroup( lang.menu );
				editor.addMenuItem( 'eqneditor', {
					label: lang.edit,
					icon: this.path + 'icons/eqneditor.png',
					command: commandName,
					group: lang.menu
				} );

				editor.contextMenu.addListener( function ( element ) {
					if ( isEquationImage( element.getAscendant( 'img', true ) ) ) {
						return { eqneditor: CKEDITOR.TRISTATE_OFF };
					}
				} );
			}

			editor.on( 'doubleclick', function ( evt ) {
				var element = evt.data.element;
				if ( !element ) return;

				if ( element.is( 'img' ) && isEquationImage( element ) ) {
					evt.data.dialog = commandName;
					return;
				}

				// A MathML equation - the converter writes the source LaTeX into the <math>
				// element's own title, so an equation carries what it was written from. Unlike
				// an <img>, double-clicking a <math> element does not make it CKEditor's
				// selection, so the dialog's onShow (dialogs/eqneditor.js) cannot recover it
				// from editor.getSelection() the way it does for an image - stashed here on
				// the editor instance instead, which onShow reads and clears.
				var mathEl = element.getAscendant( 'math', true ) || ( element.is( 'math' ) ? element : null );
				if ( mathEl && mathEl.getAttribute( 'title' ) ) {
					editor._eqneditorPendingLatex = mathEl.getAttribute( 'title' ).trim();
					editor._eqneditorPendingElement = mathEl.$;   // for the size it was inserted at
					editor._eqneditorPendingInline = mathEl.getAttribute( 'display' ) !== 'block';
					evt.data.dialog = commandName;
					return;
				}

				// LaTeX in the text, as "Insert as LaTeX" puts it: the double-click has selected a
				// word of it, and the $...$ or $$...$$ round that is the equation. Stashed for onShow
				// the same way.
				var selection = editor.getSelection(), native = selection && selection.getNative();
				var range = native && native.rangeCount ? native.getRangeAt( 0 ) : null;
				var tex = range && texAt( range.startContainer, range.startOffset );
				if ( tex ) {
					editor._eqneditorPendingTex = tex;
					evt.data.dialog = commandName;
				}
			}, null, null, 100 );
		}
	} );
}() );
