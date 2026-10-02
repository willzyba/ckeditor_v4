/*
 Dialog for the CodeCogs Equation Editor plugin for CKEditor 4.

 Embeds the shared EqEditor UI every adapter in fxPlugins uses. The dialog is
 maths-view only: no LaTeX markup and no rendered-equation preview are visible until the author
 asks for them (the LaTeX and Inline toggles, bottom-left of the footer, alongside "Insert as").
 Double-clicking an existing equation reopens this dialog with its LaTeX decoded back out of the
 image's own src, or read straight off a MathML equation's own title attribute.

 Copyright CodeCogs 2006-2026
*/
( function () {
	'use strict';

	// Presentation MathML, plus the three non-"m" elements the converter can emit.
	var MATHML_ELEMENTS = [
		'math', 'semantics', 'annotation', 'annotation-xml',
		'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace', 'mglyph',
		'mfrac', 'msqrt', 'mroot', 'mstyle', 'merror', 'mpadded', 'mphantom', 'menclose',
		'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover',
		'mmultiscripts', 'mprescripts', 'none',
		'mtable', 'mtr', 'mtd', 'mlabeledtr', 'maction'
	];

	// Fixes for gaps in the shared fxeditor.css (loaded separately, in plugin.js) that this
	// dialog needs but can't assume it will get: editor.codecogs.com, the old default host
	// and still configurable, serves an older stylesheet that predates the CCEqnEditor/CCMathViewHost/
	// CCLatexInput class names entirely (only a local dev mirror does not have this gap).
	// Injected once, since it would otherwise race fxeditor.css over which rule wins.
	// The API's own injected @font-face for "Latin Modern Math" only carries
	// local("Latin Modern Math") - no url() fallback - so it silently falls back to a generic
	// serif unless that exact font happens to be installed. A later @font-face for the same
	// family replaces the API's src list rather than merging with it, so redeclaring it here
	// with a real url() fixes every equation and symbol on the page, not just this dialog's.
	function injectStyleOverridesOnce( fontUrl ) {
		if ( document.getElementById( 'cc-eqneditor-style-overrides' ) ) return;
		var style = document.createElement( 'style' );
		style.id = 'cc-eqneditor-style-overrides';
		style.textContent =
			'@font-face { font-family: "Latin Modern Math"; font-display: swap; ' +
				'src: local("Latin Modern Math"), url("' + fontUrl.replace( /prototypes\/latinmodern-math\.otf$/, 'fonts/LatinModernMath-Regular.woff2' ) + '") format("woff2"), url("' + fontUrl + '") format("opentype"); }' +
			// Undo host resets (e.g. .cke_reset_all *) inside the toolbar icons and the maths view's MathML.
			'.CCToolbar svg:has(g[font-family]), .CCToolbar svg:has(g[font-family]) * { font: revert-layer !important; }' +
			// Icons drawn as <text>: the svg gets the API's own .cc_panel font (fxTeX Toolbar, 16px) back over host resets, and each <text> its own font-size attribute (revert-layer lets attributes win).
			'.CCToolbar svg:not(:has(g[font-family])) { font: normal normal 16px "fxTeX Toolbar" !important; }' +
			'.CCToolbar svg:not(:has(g[font-family])) * { font: revert-layer !important; }' +
			'.CCToolbar svg, .CCToolbar svg * { width: revert-layer !important; height: revert-layer !important; max-width: revert-layer !important; }' +
			'.CCToolbar svg g[font-family="fxTeX Toolbar"] { color: #000 !important; }' +
			'.CCMathView math, .CCMathView math * { font: revert-layer !important; ' +
				'width: revert-layer !important; height: revert-layer !important; padding: revert-layer !important; ' +
				'margin: revert-layer !important; text-transform: revert-layer !important; text-align: revert-layer !important; ' +
				'box-sizing: revert-layer !important; white-space: revert-layer !important; }' +
			apiMathRules() +
			'.CCEqnEditor { display: flex !important; flex-direction: column !important; ' +
				'height: 440px !important; }' +
			'.CCEqnEditor .CCEditorBar { flex: 0 0 auto; }' +
			// A flex column's children stretch to the container's full width by default -
			// this dialog is 850px wide, but the toolbar's own "fit" pass (EqEditor's
			// Toolbar.link, run once at construction) measures whatever width it is GIVEN and
			// unwraps each button group into as many columns as that width allows. Left
			// stretched, that is ~840px, well past the toolbar's natural width (~780px on the
			// reference page, which is never stretched) - so every group unwraps wider and
			// flatter than it was designed to, reading as sparse, undersized icons in a mostly
			// empty row instead of the tighter reference layout. flex-start plus width:auto
			// (both needed - a flex-start item with no width of its own still stretches
			// otherwise) leaves it free to size to its own fitted content instead.
			'.CCEqnEditor [id^="cc-eqn-ck4-toolbar-"] { align-self: flex-start; width: auto; }' +
			'.CCEqnEditor .CCMathViewHost { flex: 1 1 auto; min-height: 0; display: flex; ' +
				'align-items: center; justify-content: center; overflow: auto; }' +
			'.CCEqnEditor[data-inline="on"] .CCMathViewHost { justify-content: flex-start; }' +
			'.CCEqnEditor[data-latex="on"] .CCMathViewHost { display: none !important; }' +
			'.CCEqnEditor .CCLatexInput { flex: 1 1 auto; min-height: 0; overflow: auto; }' +
			'.CCEqnEditor[data-latex="off"] .CCLatexInput { display: none !important; }' +
			'.CCEqnEditor .CCEqnOutput-hidden { display: none !important; }' +
			// The bottom bar: toggles left, Insert-as and the dialog's buttons right, one type size. All !important - host dialog resets otherwise restyle it.
			'.cc-eqn-bar { display: flex !important; align-items: center !important; gap: 16px !important; flex: 0 0 auto !important; ' +
				'margin: 8px 0 0 !important; padding: 10px 0 0 !important; border: 0 !important; border-top: 1px solid #e2e8f0 !important; ' +
				'background: none !important; font: 13px/1.3 system-ui, -apple-system, "Segoe UI", Arial, sans-serif !important; color: #1c2530 !important; }' +
			'.cc-eqn-bar-right { display: flex !important; align-items: center !important; gap: 8px !important; margin: 0 0 0 auto !important; padding: 0 !important; font: inherit !important; color: inherit !important; }' +
			'.cc-eqn-bar .cc-switch { display: inline-flex !important; align-items: center !important; gap: 6px !important; margin: 0 !important; ' +
				'padding: 0 !important; font: inherit !important; color: #54647c !important; cursor: pointer !important; user-select: none !important; white-space: nowrap !important; }' +
			'.cc-eqn-bar .cc-switch input { position: absolute !important; width: 1px !important; height: 1px !important; margin: -1px !important; ' +
				'padding: 0 !important; border: 0 !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; opacity: 0 !important; }' +
			'.cc-eqn-bar .cc-switch-track { position: relative !important; display: inline-block !important; flex: 0 0 auto !important; width: 28px !important; ' +
				'height: 16px !important; margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 8px !important; ' +
				'background: #ccc !important; transition: background .2s !important; }' +
			'.cc-eqn-bar .cc-switch-knob { position: absolute !important; display: block !important; top: 2px !important; left: 2px !important; ' +
				'width: 12px !important; height: 12px !important; margin: 0 !important; border-radius: 50% !important; background: #fff !important; transition: left .2s !important; }' +
			'.cc-eqn-bar .cc-switch input:checked + .cc-switch-track { background: #4caf50 !important; }' +
			'.cc-eqn-bar .cc-switch input:checked + .cc-switch-track .cc-switch-knob { left: 14px !important; }' +
			'.cc-eqn-bar .cc-switch input:focus-visible + .cc-switch-track { outline: 2px solid #003794 !important; outline-offset: 2px !important; }' +
			'.cc-eqn-bar .cc-switch input:disabled ~ * { opacity: .5 !important; cursor: default !important; }' +
			'.cc-eqn-bar .cc-switch-label { font: inherit !important; color: inherit !important; }' +
			'.cc-eqn-bar .cc-switch input:checked ~ .cc-switch-label { color: #003794 !important; font-weight: 600 !important; }' +
			'.cc-eqn-bar .cc-eqn-select { width: auto !important; height: 30px !important; margin: 0 !important; padding: 0 8px !important; ' +
				'border: 1px solid #cbd5e0 !important; border-radius: 4px !important; background: #fff !important; font: inherit !important; color: #1c2530 !important; cursor: pointer !important; }' +
			'.cc-eqn-bar .cc-eqn-btn { display: inline-flex !important; align-items: center !important; height: 30px !important; margin: 0 !important; ' +
				'padding: 0 16px !important; border: 1px solid #cbd5e0 !important; border-radius: 4px !important; background: #fff !important; ' +
				'font: inherit !important; color: #1c2530 !important; cursor: pointer !important; box-shadow: none !important; }' +
			'.cc-eqn-bar .cc-eqn-btn * { font: inherit !important; color: inherit !important; }' +
			'.cc-eqn-bar .cc-eqn-btn.cc-eqn-primary { background: #2c7a4b !important; border-color: #2c7a4b !important; color: #fff !important; }' +
			// CKEditor's .cke_dialog_body (border + shadow) only wraps the title bar here; draw its edges on down around the contents.
			'.cke_dialog_contents:has(.CCEqnEditor) { box-shadow: -1px 0 0 #b2b2b2, 1px 0 0 #b2b2b2, 0 1px 0 #999, 0 0 3px rgba(0, 0, 0, .15) !important; }';
		document.head.appendChild( style );
	}

	// Re-asserts the API's own .CCMathView/.fxtex rules, which host resets and revert-layer override.
	// The `design` option (see the README): how the editor looks, set by the site rather than the
	// author. The toolbar's rows and scale go to Toolbar.link() itself; everything else is applied
	// here, once the editor is mounted - CSS scoped to this editor's root, then the starting state of
	// the LaTeX toggle and the "Insert as" menu.
	var designCount = 0;
	function applyDesign( root, design, latexToggle, insertSelect ) {
		if ( !root || !design ) return;
		if ( !root.id ) root.id = 'cc-eqn-design-' + ( ++designCount );
		var sel = '#' + root.id, css = '';
		var colour = String( design.colour || '' );
		if ( /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test( colour ) ) {
			css += sel + ' { --cc-accent: ' + colour + ';' +
				' --cc-accent-soft: color-mix(in srgb, ' + colour + ' 11%, #fff);' +
				' --cc-accent-soft-ring: color-mix(in srgb, ' + colour + ' 28%, #fff);' +
				' --cc-accent-mid: color-mix(in srgb, ' + colour + ' 22%, #fff);' +
				' --cc-accent-mid-ring: color-mix(in srgb, ' + colour + ' 43%, #fff); }';
		}
		if ( Number( design.mathSize ) > 0 ) css += sel + ' .CCMathView { font-size: ' + Number( design.mathSize ) + 'px !important; }';
		if ( Number( design.latexSize ) > 0 ) css += sel + ' .CCLatexInput { font-size: ' + Number( design.latexSize ) + 'px !important; }';
		if ( design.toolbar === false ) css += sel + ' .CCToolbar { display: none !important; }';
		if ( design.history === false ) css += sel + ' .CCEditorBar { display: none !important; }';
		if ( css ) {
			var style = document.createElement( 'style' );
			style.textContent = css;
			root.appendChild( style );
		}
		// The dialog's width and height (`width`, `height`), before any scaling: the box takes the width,
		// and the editing area whatever height makes the whole dialog the height asked for - measured,
		// since everything else in it (toolbar rows, the bottom bar) varies with the design. Hosts that
		// size their dialogs themselves (TinyMCE 4, CKEditor 4) are given both when they open it instead.
		var sizedBox = root.closest( '.tox-dialog, .mce-window, .cke_dialog, .ck-balloon-panel, .cc-eqneditor-modal, .tc-drop-down' ) || root;
		if ( !sizedBox.matches( '.mce-window, .cke_dialog' ) ) {
			if ( Number( design.width ) > 0 ) sizedBox.style.setProperty( 'width', Number( design.width ) + 'px', 'important' );
			var area = root.querySelector( '.CCMathViewHost' );
			if ( Number( design.height ) > 0 && area ) {
				// Measured, then measured again as the dialog settles - the toolbar fits itself to its row
				// after the dialog first lays out, and the fonts arrive - correcting by the difference each time.
				// A box with a height of its own (Froala's and Tiptap's modals) sizes to its contents instead.
				sizedBox.style.setProperty( 'height', 'auto', 'important' );
				var sizing = document.createElement( 'style' );
				root.appendChild( sizing );
				var h = 0;
				var fit = function () {
					var shown = root.querySelector( '.CCLatexInput' ) && getComputedStyle( area ).display === 'none'
						? root.querySelector( '.CCLatexInput' ) : area;
					// Scale may already be applied (see below), and on-screen sizes include it.
					var applied = parseFloat( sizedBox.style.zoom ) || parseFloat( ( sizedBox.style.transform.match( /scale\(([\d.]+)\)/ ) || [] )[ 1 ] ) || 1;
					var now = h || shown.getBoundingClientRect().height / applied;
					h = Math.max( 120, Math.round( now + Number( design.height ) - sizedBox.getBoundingClientRect().height / applied ) );
					// Never taller than the whole dialog asked for: a host that caps its dialog (and scrolls the
					// rest) would otherwise be chased upwards on every pass.
					h = Math.min( h, Number( design.height ) );
					sizing.textContent = '#' + root.id + ' { height: auto !important; } #' + root.id + ' .CCMathViewHost, #' + root.id + ' .CCLatexInput { height: ' + h + 'px !important; min-height: ' + h + 'px !important; }';
				};
				fit();
				[ 150, 500, 1200 ].forEach( function ( t ) { setTimeout( fit, t ); } );
			}
		}
		// The whole dialog, box and contents together - see `dialogSize` in the README. Zoomed where
		// the host lays the dialog out (it grows in place); scaled where the host positions it itself
		// (CKEditor, TinyMCE 4, a TiddlyWiki drop-down), so that placement still holds.
		var size = Number( design.dialogSize );
		if ( size > 0 && size !== 1 ) {
			var box = root.closest( '.tox-dialog, .mce-window, .cke_dialog, .ck-balloon-panel, .cc-eqneditor-modal, .tc-drop-down' ) || root;
			var position = getComputedStyle( box ).position;
			if ( position === 'absolute' || position === 'fixed' ) {
				box.style.transform = 'scale(' + size + ')';
				box.style.transformOrigin = box.matches( '.ck-balloon-panel' ) ? 'top center'
					: box.matches( '.tc-drop-down' ) ? 'top left' : 'center center';
			} else {
				box.style.zoom = String( size );
				box.style.setProperty( 'max-width', 'calc(96vw / ' + size + ')', 'important' );   // still no wider than the window
			}
		}
		if ( insertSelect && design.insertAs && insertSelect.querySelector( 'option[value="' + design.insertAs + '"]' ) ) {
			insertSelect.value = design.insertAs;
		}
		if ( latexToggle && design.latex && !latexToggle.checked && !latexToggle.disabled ) {
			latexToggle.checked = true;
			latexToggle.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		}
	}

	function apiMathRules() {
		var out = '';
		for ( var i = 0; i < document.styleSheets.length; i++ ) {
			var rules;
			try { rules = document.styleSheets[ i ].cssRules; } catch ( e ) { continue; }
			for ( var j = 0; j < rules.length; j++ ) {
				var r = rules[ j ], decls = '';
				if ( !r.selectorText || !/(^|,)\s*\.(fxtex|CCMathView)\b/.test( r.selectorText ) ) continue;
				for ( var k = 0; k < r.style.length; k++ ) {
					decls += r.style[ k ] + ':' + r.style.getPropertyValue( r.style[ k ] ) + ' !important;';
				}
				if ( decls ) {
					out += r.selectorText.split( ',' ).map( function ( s ) {
						s = s.trim();
						return /^\.CCMathView\b/.test( s ) ? s : '.CCMathView ' + s;
					} ).join( ',' ) + '{' + decls + '}';
				}
			}
		}
		return out;
	}

	function decodeEquation( encoded ) {
		var latex = encoded;
		try {
			latex = decodeURIComponent( encoded );
		} catch ( e ) {
			// Not valid percent-encoding; still worth showing as it stands.
		}
		return latex.replace( /&space;/g, ' ' ).replace( /&plus;/g, '+' ).replace( /&hash;/g, '#' );
	}

	// EqEditor.init() switches the converter every TextArea/MathView/Toolbar construction takes
	// on to fxTeX Pro - skip it and they keep the placeholder converter for their whole
	// lifetime, even once fxeditor.api.min.js itself has loaded. Called once per page; an
	// empty licence is the normal, expected state until a real one is configured.
	var initPromise = null;

	function ensureInit( licence ) {
		if ( initPromise ) return initPromise;
		initPromise = ( typeof EqEditor.init === 'function' )
			? EqEditor.init( { licence: licence || '' } ).catch( function ( err ) {
				window.console && console.warn( 'fxTeX Pro: ' + ( err && err.message || err ) );
			} )
			: Promise.resolve();
		return initPromise;
	}

	var instanceCount = 0;

	CKEDITOR.dialog.add( 'eqneditorDialog', function ( editor ) {
		instanceCount++;
		var n = instanceCount;
		var ids = {
			root: 'cc-eqn-ck4-' + n,
			history: 'cc-eqn-ck4-history-' + n,
			toolbar: 'cc-eqn-ck4-toolbar-' + n,
			mathview: 'cc-eqn-ck4-mathview-' + n,
			latexInput: 'cc-eqn-ck4-latex-' + n,
			output: 'cc-eqn-ck4-output-' + n,
			toggleInline: 'cc-eqn-ck4-toggle-inline-' + n,
			toggleLatex: 'cc-eqn-ck4-toggle-latex-' + n,
			insertMode: 'cc-eqn-ck4-insert-mode-' + n
		};

		var renderUrl = editor.config.eqneditor_render_url || 'https://latex.codecogs.com';
		var licence = editor.config.eqneditor_licence || '';
		var design = editor.config.eqneditor_design || {};
		var cssUrl = editor.config.eqneditor_css_url ||
			( ( /^https?:\/\//.test( editor.config.eqneditor_server || '' ) ? editor.config.eqneditor_server.replace( /\/+$/, '' )
				: 'https://' + ( editor.config.eqneditor_server || 'fxtex.codecogs.com' ) ) + '/fxeditor.css' );

		var eqOutput = null, eqTextArea = null, eqMathView = null, eqToolbar = null;
		var mounted = false;

		function applyLatexVisible( visible ) {
			var root = document.getElementById( ids.root );
			if ( root ) root.setAttribute( 'data-latex', visible ? 'on' : 'off' );
			if ( eqToolbar ) eqToolbar.setActiveTextArea( visible ? eqTextArea : ( eqMathView || eqTextArea ) );
		}

		function applyInline( inline ) {
			var root = document.getElementById( ids.root );
			if ( root ) root.setAttribute( 'data-inline', inline ? 'on' : 'off' );
			if ( eqMathView ) eqMathView.setInline( inline );
			if ( eqOutput ) eqOutput.setInline( inline );
		}

		function mount() {
			if ( mounted ) return;
			mounted = true;

			eqOutput = new EqEditor.Output( ids.output );
			eqOutput.setRenderURL( renderUrl );

			eqTextArea = EqEditor.TextArea.link( ids.latexInput )
				.addOutput( eqOutput )
				.addHistoryMenu( new EqEditor.History( ids.history ) );

			eqToolbar = EqEditor.Toolbar.link( ids.toolbar, design.toolbar || 'default', design.toolbarScale || 1 ).addTextArea( eqTextArea );

			var latexToggle = document.getElementById( ids.toggleLatex );

			if ( typeof EqEditor.MathView !== 'undefined' ) {
				eqMathView = EqEditor.MathView.link( ids.mathview ).addTextArea( eqTextArea );
				eqToolbar.addMathView( eqMathView );
			} else {
				// Without a maths view the markup is the only thing to edit in - force it
				// visible and lock the toggle so it cannot be switched to an empty pane.
				applyLatexVisible( true );
				latexToggle.checked = true;
				latexToggle.disabled = true;
			}

			latexToggle.addEventListener( 'change', function ( e ) { applyLatexVisible( e.target.checked ); } );
			document.getElementById( ids.toggleInline ).addEventListener( 'change', function ( e ) {
				applyInline( e.target.checked );
			} );

			applyDesign( document.getElementById( ids.root ), design, latexToggle, document.getElementById( ids.insertMode ) );
			// The editor fills the dialog's contents, 30px short of its minHeight - see minHeight below.
			if ( Number( design.height ) > 0 ) {
				document.getElementById( ids.root ).style.setProperty( 'height',
					( Math.max( 300, Number( design.height ) - 90 ) - 30 ) + 'px', 'important' );
			}
		}

		function panelHtml() {
			return '' +
				'<div id="' + ids.root + '" class="CCEqnEditor" data-latex="off" data-inline="off">' +
					'<div class="CCEditorBar"><div id="' + ids.history + '" class="CCHistory"></div></div>' +
					'<div id="' + ids.toolbar + '"></div>' +
					'<div id="' + ids.mathview + '" class="CCMathViewHost"></div>' +
					'<div id="' + ids.latexInput + '" class="CCLatexInput" autocorrect="off" ' +
						'placeholder="Write LaTeX here..."></div>' +
					// No rendered-equation preview in the dialog any more - MathView is the
					// whole editing surface. eqOutput still needs a DOM element to bind to (it
					// builds the SVG URL for the "Image (SVG)" insert mode), so the element
					// stays, just not visible.
					'<img id="' + ids.output + '" class="CCEqnOutput-hidden" alt="">' +
					'<div class="cc-eqneditor-bottombar cc-eqn-bar">' +
						'<label class="cc-switch" title="Left-align the equation instead of centring it">' +
							'<input type="checkbox" id="' + ids.toggleInline + '">' +
							'<span class="cc-switch-track"><span class="cc-switch-knob"></span></span>' +
							'<span class="cc-switch-label">Inline</span>' +
						'</label>' +
						'<label class="cc-switch" title="Show or hide the LaTeX markup">' +
							'<input type="checkbox" id="' + ids.toggleLatex + '">' +
							'<span class="cc-switch-track"><span class="cc-switch-knob"></span></span>' +
							'<span class="cc-switch-label">LaTeX markup</span>' +
						'</label>' +
						'<div class="cc-eqn-bar-right">' +
							'<select class="cc-eqn-select" id="' + ids.insertMode + '" title="How to insert the equation">' +
								'<option value="mathml" selected>Insert as MathML</option>' +
								'<option value="svg">Insert as image (SVG)</option>' +
							'</select>' +
						'</div>' +
					'</div>' +
				'</div>';
		}

		return {
			title: editor.lang.eqneditor.title,
			// The design's `width` is the whole dialog's - its frame and padding (22px) included.
			minWidth: Number( design.width ) > 0 ? Math.max( 400, Number( design.width ) - 22 ) : 850,
			// CKEditor 4's dialog engine gives the contents area roughly minHeight + 22px
			// regardless of what the content actually needs, then never shrinks it back down -
			// so this has to match .CCEqnEditor's own 440px (see injectStyleOverridesOnce) plus
			// its bottom bar, not the dialog's old, taller pre-redesign content. Measured against
			// the live dialog rather than guessed: a bigger number here reproduces as dead grey
			// space between the maths view and the Cancel/OK row, not a taller maths view.
			// The design's `height` is the whole dialog's - title bar and buttons (about 90px) included.
			minHeight: Number( design.height ) > 0 ? Math.max( 300, Number( design.height ) - 90 ) : 470,
			resizable: CKEDITOR.DIALOG_RESIZE_NONE,
			contents: [
				{
					id: 'CCEquationEditor',
					label: 'EqnEditor',
					elements: [ { type: 'html', html: panelHtml() } ]
				}
			],

			// The scripts are requested back in plugin.js, at editor init - by the time a user
			// has actually opened this dialog they are very likely loaded already, but onShow
			// still waits rather than assuming so, since a dialog that opens onto half-built
			// markup is a worse failure than a short, silent wait.
			onShow: function () {
				var initialLatex = '';

				// Set by plugin.js's doubleclick handler when a MathML equation (rather than
				// an <img> one) was double-clicked - see the comment there for why this can't
				// come from editor.getSelection() the way the <img> case below does.
				if ( editor._eqneditorPendingLatex ) {
					initialLatex = editor._eqneditorPendingLatex;
					editor._eqneditorPendingLatex = null;
				} else {
					var image = editor.getSelection().getStartElement().getAscendant( 'img', true );
					if ( image ) {
						var match = image.getAttribute( 'src' ).match( /(gif|svg|png)\.image\?(.*)/ );
						if ( match ) initialLatex = decodeEquation( match[ 2 ] );
					}
				}

				function whenReady() {
					if ( typeof window.EqEditor === 'undefined' ) {
						setTimeout( whenReady, 100 );
						return;
					}

					ensureInit( licence ).then( function () {
						injectStyleOverridesOnce( cssUrl.slice( 0, cssUrl.lastIndexOf( '/' ) + 1 ) + 'prototypes/latinmodern-math.otf' );
						mount();
						eqTextArea.clear();
						if ( initialLatex ) eqTextArea.insert( initialLatex, initialLatex.length );
						eqTextArea.notifyOutputs();
					} );
				}

				whenReady();
			},

			onOk: function () {
				if ( !eqTextArea ) return;

				var latex = eqTextArea.getTextArea().textContent.trim();
				if ( !latex ) return;

				var mode = document.getElementById( ids.insertMode ).value;

				if ( mode === 'svg' ) {
					var eqn = editor.document.createElement( 'img' );
					eqn.setAttribute( 'alt', latex );
					eqn.setAttribute( 'src', eqOutput.exportAs( 'url' ) );
					// referrerpolicy explicitly, rather than leaving it to the page's own
					// Referrer-Policy: latex.codecogs.com identifies the calling site by
					// referer, and a page with a stricter policy (or none at all, on some
					// browsers' defaults) would otherwise send none at all.
					eqn.setAttribute( 'referrerpolicy', 'origin' );
					editor.insertElement( eqn );
				} else {
					// createFromHtml rather than a string passed to insertHtml(): CKEditor 4's
					// Advanced Content Filter runs on insertHtml() and does not know <math>
					// (extending allowedContent to include it did not survive an actual test -
					// insertElement() with an already-built element bypasses ACF instead,
					// exactly like the existing <img> insert above always has).
					var mathEl = CKEDITOR.dom.element.createFromHtml( eqOutput.exportAs( 'mathml' ), editor.document );
					editor.insertElement( mathEl );
				}

				eqTextArea.pushToHistory();
			},

			onHide: function () {
				if ( eqTextArea ) eqTextArea.close();
			}
		};
	} );
}() );
