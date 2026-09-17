/*
 Dialog for the CodeCogs Equation Editor plugin for CKEditor 4.

 Embeds the shared EqEditor UI every adapter in eqneditor-v5-plugins uses. The dialog is
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

	// Fixes for gaps in the shared eqneditor.css (loaded separately, in plugin.js) that this
	// dialog needs but can't assume it will get: the default host, editor.codecogs.com,
	// currently serves an older stylesheet that predates the CCEqnEditor/CCMathViewHost/
	// CCLatexInput class names entirely (only a local dev mirror does not have this gap).
	// Injected once, since it would otherwise race eqneditor.css over which rule wins.
	function injectStyleOverridesOnce() {
		if ( document.getElementById( 'cc-eqneditor-style-overrides' ) ) return;
		var style = document.createElement( 'style' );
		style.id = 'cc-eqneditor-style-overrides';
		style.textContent =
			'.CCEqnEditor { display: flex !important; flex-direction: column !important; ' +
				'height: 440px !important; }' +
			'.CCEqnEditor .CCEditorBar { flex: 0 0 auto; }' +
			'.CCEqnEditor .CCMathViewHost { flex: 1 1 auto; min-height: 0; display: flex; ' +
				'align-items: center; justify-content: center; overflow: auto; }' +
			'.CCEqnEditor[data-inline="on"] .CCMathViewHost { justify-content: flex-start; }' +
			'.CCEqnEditor[data-latex="on"] .CCMathViewHost { display: none !important; }' +
			'.CCEqnEditor .CCLatexInput { flex: 1 1 auto; min-height: 0; overflow: auto; }' +
			'.CCEqnEditor[data-latex="off"] .CCLatexInput { display: none !important; }' +
			'.CCEqnEditor .CCEqnOutput-hidden { display: none !important; }' +
			'.cc-eqneditor-bottombar { display: flex; align-items: center; gap: 14px; ' +
				'padding-top: 8px; margin-top: 6px; border-top: 1px solid #e2e8f0; }' +
			'.cc-eqneditor-bottombar select { font-size: 12px; padding: 4px 6px; }';
		document.head.appendChild( style );
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

			eqToolbar = EqEditor.Toolbar.link( ids.toolbar, 'default', 1.4 ).addTextArea( eqTextArea );

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
					'<div class="cc-eqneditor-bottombar">' +
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
						'<select id="' + ids.insertMode + '" title="How to insert the equation">' +
							'<option value="mathml" selected>Insert as MathML</option>' +
							'<option value="svg">Insert as image (SVG)</option>' +
						'</select>' +
					'</div>' +
				'</div>';
		}

		return {
			title: editor.lang.eqneditor.title,
			minWidth: 850,
			minHeight: 560,
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

					injectStyleOverridesOnce();
					mount();
					eqTextArea.clear();
					if ( initialLatex ) eqTextArea.insert( initialLatex, initialLatex.length );
					eqTextArea.notifyOutputs();
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
