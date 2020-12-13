/**
 * External dependencies
 */
import { flatMap, filter, compact, difference, identity } from 'lodash';
/**
 * WordPress dependencies
 */
import {
	getPhrasingContentSchema,
	removeInvalidHTML,
	unwrap,
} from '@wordpress/dom';
/**
 * Internal dependencies
 */
import { createBlock, getBlockTransforms, findTransform } from '../factory';
import { hasBlockSupport } from '../registration';
import { getBlockContent } from '../serializer';
import { getBlockAttributes, parseWithGrammar } from '../parser';
import normaliseBlocks from './normalise-blocks';
import specialCommentConverter from './special-comment-converter';
import commentRemover from './comment-remover';
import isInlineContent from './is-inline-content';
import phrasingContentReducer from './phrasing-content-reducer';
import headRemover from './head-remover';
import msListConverter from './ms-list-converter';
import listReducer from './list-reducer';
import imageCorrector from './image-corrector';
import blockquoteNormaliser from './blockquote-normaliser';
import figureContentReducer from './figure-content-reducer';
import shortcodeConverter from './shortcode-converter';
import markdownConverter from './markdown-converter';
import iframeRemover from './iframe-remover';
import googleDocsUIDRemover from './google-docs-uid-remover';
import htmlFormattingRemover from './html-formatting-remover';
import brRemover from './br-remover';
import { deepFilterHTML, isPlain, getBlockContentSchema } from './utils';
import emptyParagraphRemover from './empty-paragraph-remover';

/**
 * Browser dependencies
 */
const { console } = window;

const stylesToSkip = [
	'box-sizing',
	'background-color',
	'font-family',
	'border-radius',
];
const getNonDefaultStyles = ( { defaultStylesEntries, stylesEntries } ) =>
	stylesEntries.reduce( ( acc, [ key, values ] ) => {
		const defaultValues =
			( defaultStylesEntries.find(
				( [ defaultKey ] ) => defaultKey === key
			) || [] )[ 1 ] || [];
		const diff = difference( values, defaultValues );
		const nonDefaultStyles = diff.length
			? {
					[ key ]: diff,
			  }
			: {};
		return {
			...acc,
			...nonDefaultStyles,
		};
	}, {} );

const getStylesEntries = ( stylesString ) => {
	const stylesArr = stylesString
		.replace( /\(.*?\)/g, ( match ) => match.replace( / /g, '_' ) )
		.split( ';' )
		.filter( identity );

	return stylesArr.map( ( styles ) => {
		const [ key, values = [] ] = styles.trim().split( ':' );
		if ( key === 'color' ) return [ key, [ values ] ];
		const valuesArr = values.split( ', ' ).map( ( w ) => w.trim() );
		return [ key, valuesArr ];
	} );
};

const defaultStyles =
	"color: rgb(40, 48, 61); font-family: -apple-system, system-ui, 'Segoe UI', Roboto, Oxygen-Sans, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif; font-size: 20px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; white-space: pre-wrap; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; background-color: rgb(209, 228, 221); text-decoration-style: initial; text-decoration-color: initial; display: inline !important; float: none;";

const fromObjToString = ( obj ) =>
	Object.entries( obj )
		.map( ( pair ) => pair.join( ':' ) )
		.join( '; ' );

export const applyToAllSuccessors = ( { head, fn } ) => {
	if ( ! head ) return;
	for ( const child of head.children ) {
		fn( child );
		applyToAllSuccessors( { head: child, fn } );
	}
};
const removeDefaultStyles = ( element ) => {
	const elementStyles = element.style.cssText;
	const defaultStylesEntries = getStylesEntries( defaultStyles );
	const stylesEntries = getStylesEntries( elementStyles );

	const diff = getNonDefaultStyles( {
		defaultStylesEntries,
		stylesEntries,
	} );
	const withoutUnimportantProps = Object.fromEntries(
		Object.entries( diff ).filter(
			( [ key ] ) => ! stylesToSkip.includes( key )
		)
	);
	const nonDefaultStyles = fromObjToString(
		withoutUnimportantProps
	).replace( /\(.*?\)/g, ( match ) => match.replace( /_/g, '' ) );
	element.style = nonDefaultStyles;
};

const removeDefaultStylesFromAllElements = ( html ) => {
	const container = document.createElement( 'div' );
	container.innerHTML = html;
	applyToAllSuccessors( {
		head: container,
		fn: removeDefaultStyles,
	} );
	return container.innerHTML;
};

const unwrapSpansWithNoStylesAndAtrrs = ( HTML ) => {
	const container = document.createElement( 'div' );
	container.innerHTML = HTML;
	applyToAllSuccessors( {
		head: container,
		fn: ( element ) => {
			const { style, attributes } = element;
			const hasNoStylesOrAttrs =
				! style.cssText &&
				! [ ...attributes ].filter( ( attr ) => attr.name !== 'style' )
					.length;
			if ( hasNoStylesOrAttrs ) unwrap( element );
		},
	} );
	return container.innerHTML;
};

/**
 * Filters HTML to only contain phrasing content.
 *
 * @param {string}  HTML The HTML to filter.
 * @param {boolean} preserveWhiteSpace Whether or not to preserve consequent white space.
 *
 * @return {string} HTML only containing phrasing content.
 */
function filterInlineHTML( HTML, preserveWhiteSpace ) {
	HTML = removeDefaultStylesFromAllElements( HTML );
	HTML = deepFilterHTML( HTML, [
		googleDocsUIDRemover,
		phrasingContentReducer,
		commentRemover,
	] );
	// HTML = removeInvalidHTML( HTML, getPhrasingContentSchema( 'paste' ), {
	// 	inline: true,
	// } );

	if ( ! preserveWhiteSpace ) {
		HTML = deepFilterHTML( HTML, [ htmlFormattingRemover, brRemover ] );
	}

	HTML = unwrapSpansWithNoStylesAndAtrrs( HTML );
	// Allows us to ask for this information when we get a report.
	console.log( 'Processed inline HTML:\n\n', HTML );

	return HTML;
}

function getRawTransformations() {
	return filter( getBlockTransforms( 'from' ), { type: 'raw' } ).map(
		( transform ) => {
			return transform.isMatch
				? transform
				: {
						...transform,
						isMatch: ( node ) =>
							transform.selector &&
							node.matches( transform.selector ),
				  };
		}
	);
}

/**
 * Converts HTML directly to blocks. Looks for a matching transform for each
 * top-level tag. The HTML should be filtered to not have any text between
 * top-level tags and formatted in a way that blocks can handle the HTML.
 *
 * @param  {Object} $1               Named parameters.
 * @param  {string} $1.html          HTML to convert.
 * @param  {Array}  $1.rawTransforms Transforms that can be used.
 *
 * @return {Array} An array of blocks.
 */
function htmlToBlocks( { html, rawTransforms } ) {
	const doc = document.implementation.createHTMLDocument( '' );

	doc.body.innerHTML = html;

	return Array.from( doc.body.children ).map( ( node ) => {
		const rawTransform = findTransform( rawTransforms, ( { isMatch } ) =>
			isMatch( node )
		);

		if ( ! rawTransform ) {
			return createBlock(
				// Should not be hardcoded.
				'core/html',
				getBlockAttributes( 'core/html', node.outerHTML )
			);
		}

		const { transform, blockName } = rawTransform;

		if ( transform ) {
			return transform( node );
		}
		return createBlock(
			blockName,
			getBlockAttributes( blockName, node.outerHTML )
		);
	} );
}

/**
 * Converts an HTML string to known blocks. Strips everything else.
 *
 * @param {Object}  options
 * @param {string}  [options.HTML]      The HTML to convert.
 * @param {string}  [options.plainText] Plain text version.
 * @param {string}  [options.mode]      Handle content as blocks or inline content.
 *                                      * 'AUTO': Decide based on the content passed.
 *                                      * 'INLINE': Always handle as inline content, and return string.
 *                                      * 'BLOCKS': Always handle as blocks, and return array of blocks.
 * @param {Array}   [options.tagName]   The tag into which content will be inserted.
 * @param {boolean} [options.preserveWhiteSpace] Whether or not to preserve consequent white space.
 *
 * @return {Array|string} A list of blocks or a string, depending on `handlerMode`.
 */
export function pasteHandler( {
	HTML = '',
	plainText = '',
	mode = 'AUTO',
	tagName,
	preserveWhiteSpace,
} ) {
	// First of all, strip any meta tags.
	HTML = HTML.replace( /<meta[^>]+>/g, '' );
	// Strip Windows markers.
	HTML = HTML.replace(
		/^\s*<html[^>]*>\s*<body[^>]*>(?:\s*<!--\s*StartFragment\s*-->)?/i,
		''
	);
	HTML = HTML.replace(
		/(?:<!--\s*EndFragment\s*-->\s*)?<\/body>\s*<\/html>\s*$/i,
		''
	);

	// If we detect block delimiters in HTML, parse entirely as blocks.
	if ( mode !== 'INLINE' ) {
		// Check plain text if there is no HTML.
		const content = HTML ? HTML : plainText;

		if ( content.indexOf( '<!-- wp:' ) !== -1 ) {
			return parseWithGrammar( content );
		}
	}

	// Normalize unicode to use composed characters.
	// This is unsupported in IE 11 but it's a nice-to-have feature, not mandatory.
	// Not normalizing the content will only affect older browsers and won't
	// entirely break the app.
	// See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize
	// See: https://core.trac.wordpress.org/ticket/30130
	// See: https://github.com/WordPress/gutenberg/pull/6983#pullrequestreview-125151075
	if ( String.prototype.normalize ) {
		HTML = HTML.normalize();
	}

	// Parse Markdown (and encoded HTML) if:
	// * There is a plain text version.
	// * There is no HTML version, or it has no formatting.
	if ( plainText && ( ! HTML || isPlain( HTML ) ) ) {
		HTML = markdownConverter( plainText );

		// Switch to inline mode if:
		// * The current mode is AUTO.
		// * The original plain text had no line breaks.
		// * The original plain text was not an HTML paragraph.
		// * The converted text is just a paragraph.
		if (
			mode === 'AUTO' &&
			plainText.indexOf( '\n' ) === -1 &&
			plainText.indexOf( '<p>' ) !== 0 &&
			HTML.indexOf( '<p>' ) === 0
		) {
			mode = 'INLINE';
		}
	}

	if ( mode === 'INLINE' ) {
		return filterInlineHTML( HTML, preserveWhiteSpace );
	}

	// An array of HTML strings and block objects. The blocks replace matched
	// shortcodes.
	const pieces = shortcodeConverter( HTML );

	// The call to shortcodeConverter will always return more than one element
	// if shortcodes are matched. The reason is when shortcodes are matched
	// empty HTML strings are included.
	const hasShortcodes = pieces.length > 1;

	if (
		mode === 'AUTO' &&
		! hasShortcodes &&
		isInlineContent( HTML, tagName )
	) {
		return filterInlineHTML( HTML, preserveWhiteSpace );
	}

	const rawTransforms = getRawTransformations();
	const phrasingContentSchema = getPhrasingContentSchema( 'paste' );
	const blockContentSchema = getBlockContentSchema(
		rawTransforms,
		phrasingContentSchema,
		true
	);

	const blocks = compact(
		flatMap( pieces, ( piece ) => {
			// Already a block from shortcode.
			if ( typeof piece !== 'string' ) {
				return piece;
			}

			const filters = [
				googleDocsUIDRemover,
				msListConverter,
				headRemover,
				listReducer,
				imageCorrector,
				phrasingContentReducer,
				specialCommentConverter,
				commentRemover,
				iframeRemover,
				figureContentReducer,
				blockquoteNormaliser,
			];

			const schema = {
				...blockContentSchema,
				// Keep top-level phrasing content, normalised by `normaliseBlocks`.
				...phrasingContentSchema,
			};

			piece = deepFilterHTML( piece, filters, blockContentSchema );
			piece = removeInvalidHTML( piece, schema );
			piece = normaliseBlocks( piece );
			piece = deepFilterHTML(
				piece,
				[ htmlFormattingRemover, brRemover, emptyParagraphRemover ],
				blockContentSchema
			);

			// Allows us to ask for this information when we get a report.
			console.log( 'Processed HTML piece:\n\n', piece );

			return htmlToBlocks( { html: piece, rawTransforms } );
		} )
	);

	// If we're allowed to return inline content, and there is only one inlineable block,
	// and the original plain text content does not have any line breaks, then
	// treat it as inline paste.
	if (
		mode === 'AUTO' &&
		blocks.length === 1 &&
		hasBlockSupport( blocks[ 0 ].name, '__unstablePasteTextInline', false )
	) {
		const trimmedPlainText = plainText.trim();

		if (
			trimmedPlainText !== '' &&
			trimmedPlainText.indexOf( '\n' ) === -1
		) {
			return removeInvalidHTML(
				getBlockContent( blocks[ 0 ] ),
				phrasingContentSchema
			);
		}
	}

	return blocks;
}
