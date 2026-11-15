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

	var DEFAULT_HOST = 'fxtex.codecogs.com';

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

	CKEDITOR.plugins.add( 'eqneditor', {
		requires: [ 'dialog' ],
		lang: 'de,en,es,fr,it',
		icons: 'eqneditor',

		init: function ( editor ) {
			var host = editor.config.eqneditor_server || DEFAULT_HOST;
			// A bare host means https; a full origin (e.g. http://localhost:8010 for local development) is used as it is.
			var origin = /^https?:\/\//.test( host ) ? host.replace( /\/+$/, '' ) : 'https://' + host;
			var scriptUrl = editor.config.eqneditor_script_url || ( origin + '/fxeditor.api.min.js' );
			var cssUrl = editor.config.eqneditor_css_url || ( origin + '/fxeditor.css' );

			loadScriptOnce( scriptUrl ).catch( function ( err ) { console.error( err ); } );
			loadCssOnce( cssUrl );

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
					evt.data.dialog = commandName;
				}
			}, null, null, 100 );
		}
	} );
}() );
