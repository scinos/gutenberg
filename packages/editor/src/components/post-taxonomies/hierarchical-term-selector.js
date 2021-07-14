/**
 * External dependencies
 */
import { get, unescape as unescapeString, without, find, some } from 'lodash';

/**
 * WordPress dependencies
 */
import { __, _x, _n, sprintf } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import {
	CheckboxControl,
	TreeSelect,
	withFilters,
	Button,
} from '@wordpress/components';
import { withSelect, withDispatch } from '@wordpress/data';
import { compose, useDebounce, useInstanceId } from '@wordpress/compose';
import { store as coreStore } from '@wordpress/core-data';
import { speak } from '@wordpress/a11y';

/**
 * Internal dependencies
 */
import { buildTermsTree } from '../../utils/terms';
import { store as editorStore } from '../../store';

/**
 * Sort Terms by Selected.
 *
 * @param {Object[]} termsTree Array of terms in tree format.
 * @param {number[]} terms     Selected terms.
 *
 * @return {Object[]} Sorted array of terms.
 */
function sortBySelected( termsTree, terms ) {
	const treeHasSelection = ( termTree ) => {
		if ( terms.indexOf( termTree.id ) !== -1 ) {
			return true;
		}
		if ( undefined === termTree.children ) {
			return false;
		}
		const anyChildIsSelected =
			termTree.children
				.map( treeHasSelection )
				.filter( ( child ) => child ).length > 0;
		if ( anyChildIsSelected ) {
			return true;
		}
		return false;
	};
	const termOrChildIsSelected = ( termA, termB ) => {
		const termASelected = treeHasSelection( termA );
		const termBSelected = treeHasSelection( termB );

		if ( termASelected === termBSelected ) {
			return 0;
		}

		if ( termASelected && ! termBSelected ) {
			return -1;
		}

		if ( ! termASelected && termBSelected ) {
			return 1;
		}

		return 0;
	};
	termsTree.sort( termOrChildIsSelected );
	return termsTree;
}

/**
 * Find term by parent id or name.
 *
 * @param {Object[]}      terms  Array of Terms.
 * @param {number|string} parent id.
 * @param {string}        name   Term name.
 * @return {Object} Term object.
 */
function findTerm( terms, parent, name ) {
	return find( terms, ( term ) => {
		return (
			( ( ! term.parent && ! parent ) ||
				parseInt( term.parent ) === parseInt( parent ) ) &&
			term.name.toLowerCase() === name.toLowerCase()
		);
	} );
}

/**
 * Get filter matcher function.
 *
 * @param {string} filterValue Filter value.
 * @return {(function(Object): (Object|boolean))} Matcher function.
 */
function getFilterMatcher( filterValue ) {
	const matchTermsForFilter = ( originalTerm ) => {
		if ( '' === filterValue ) {
			return originalTerm;
		}

		// Shallow clone, because we'll be filtering the term's children and
		// don't want to modify the original term.
		const term = { ...originalTerm };

		// Map and filter the children, recursive so we deal with grandchildren
		// and any deeper levels.
		if ( term.children.length > 0 ) {
			term.children = term.children
				.map( matchTermsForFilter )
				.filter( ( child ) => child );
		}

		// If the term's name contains the filterValue, or it has children
		// (i.e. some child matched at some point in the tree) then return it.
		if (
			-1 !==
				term.name.toLowerCase().indexOf( filterValue.toLowerCase() ) ||
			term.children.length > 0
		) {
			return term;
		}

		// Otherwise, return false. After mapping, the list of terms will need
		// to have false values filtered out.
		return false;
	};
	return matchTermsForFilter;
}

const MIN_TERMS_COUNT_FOR_FILTER = 8;

function HierarchicalTermSelector( {
	onUpdateTerms,
	addTerm,
	taxonomy,
	terms,
	slug,
	availableTerms,
	hasCreateAction,
	hasAssignAction,
	availableTermsTree,
} ) {
	const instanceId = useInstanceId( HierarchicalTermSelector );

	const loading = false;
	const [ adding, setAdding ] = useState( false );
	const [ formName, setFormName ] = useState( '' );
	const [ formParent, setFormParent ] = useState( '' );
	const [ showForm, setShowForm ] = useState( false );
	const [ filterValue, setFilterValue ] = useState( '' );
	const [ filteredTermsTree, setFilteredTermsTree ] = useState( [] );
	const debouncedSpeak = useDebounce( speak, 500 );

	if ( ! hasAssignAction ) {
		return null;
	}

	const onChange = ( termId ) => {
		const hasTerm = terms.indexOf( termId ) !== -1;
		const newTerms = hasTerm
			? without( terms, termId )
			: [ ...terms, termId ];
		onUpdateTerms( newTerms, taxonomy.rest_base );
	};

	const onChangeFormName = ( event ) => {
		const newValue =
			event.target.value.trim() === '' ? '' : event.target.value;
		setFormName( newValue );
	};

	const onChangeFormParent = ( newParent ) => {
		setFormParent( newParent );
	};

	const onToggleForm = () => {
		setShowForm( ! showForm );
	};

	const onAddTerm = async ( event ) => {
		event.preventDefault();
		if ( formName === '' || adding ) {
			return;
		}

		// check if the term we are adding already exists
		const existingTerm = findTerm( availableTerms, formParent, formName );
		if ( existingTerm ) {
			// if the term we are adding exists but is not selected select it
			if ( ! some( terms, ( term ) => term === existingTerm.id ) ) {
				onUpdateTerms(
					[ ...terms, existingTerm.id ],
					taxonomy.rest_base
				);
			}

			setFormName( '' );
			setFormParent( '' );

			return;
		}
		setAdding( true );

		const newTerm = await addTerm(
			{
				name: formName,
				parent: formParent ? formParent : undefined,
			},
			slug
		);

		const termAddedMessage = sprintf(
			/* translators: %s: taxonomy name */
			_x( '%s added', 'term' ),
			get(
				taxonomy,
				[ 'labels', 'singular_name' ],
				slug === 'category' ? __( 'Category' ) : __( 'Term' )
			)
		);
		speak( termAddedMessage, 'assertive' );
		setAdding( false );
		setFormName( '' );
		setFormParent( '' );
		onUpdateTerms( [ ...terms, newTerm.id ], taxonomy.rest_base );
	};

	const renderTerms = ( renderedTerms ) => {
		return renderedTerms.map( ( term ) => {
			return (
				<div
					key={ term.id }
					className="editor-post-taxonomies__hierarchical-terms-choice"
				>
					<CheckboxControl
						checked={ terms.indexOf( term.id ) !== -1 }
						onChange={ () => {
							const termId = parseInt( term.id, 10 );
							onChange( termId );
						} }
						label={ unescapeString( term.name ) }
					/>
					{ !! term.children.length && (
						<div className="editor-post-taxonomies__hierarchical-terms-subchoices">
							{ renderTerms( term.children ) }
						</div>
					) }
				</div>
			);
		} );
	};

	const setFilter = ( event ) => {
		const value = event.target.value;
		const newFilteredTermsTree = availableTermsTree
			.map( getFilterMatcher( filterValue ) )
			.filter( ( term ) => term );
		const getResultCount = ( termsTree ) => {
			let count = 0;
			for ( let i = 0; i < termsTree.length; i++ ) {
				count++;
				if ( undefined !== termsTree[ i ].children ) {
					count += getResultCount( termsTree[ i ].children );
				}
			}
			return count;
		};

		setFilterValue( value );
		setFilteredTermsTree( newFilteredTermsTree );

		const resultCount = getResultCount( newFilteredTermsTree );
		const resultsFoundMessage = sprintf(
			/* translators: %d: number of results */
			_n( '%d result found.', '%d results found.', resultCount ),
			resultCount
		);

		debouncedSpeak( resultsFoundMessage, 'assertive' );
	};

	const labelWithFallback = (
		labelProperty,
		fallbackIsCategory,
		fallbackIsNotCategory
	) =>
		get(
			taxonomy,
			[ 'labels', labelProperty ],
			slug === 'category' ? fallbackIsCategory : fallbackIsNotCategory
		);
	const newTermButtonLabel = labelWithFallback(
		'add_new_item',
		__( 'Add new category' ),
		__( 'Add new term' )
	);
	const newTermLabel = labelWithFallback(
		'new_item_name',
		__( 'Add new category' ),
		__( 'Add new term' )
	);
	const parentSelectLabel = labelWithFallback(
		'parent_item',
		__( 'Parent Category' ),
		__( 'Parent Term' )
	);
	const noParentOption = `— ${ parentSelectLabel } —`;
	const newTermSubmitLabel = newTermButtonLabel;
	const inputId = `editor-post-taxonomies__hierarchical-terms-input-${ instanceId }`;
	const filterInputId = `editor-post-taxonomies__hierarchical-terms-filter-${ instanceId }`;
	const filterLabel = get(
		taxonomy,
		[ 'labels', 'search_items' ],
		__( 'Search Terms' )
	);
	const groupLabel = get( taxonomy, [ 'name' ], __( 'Terms' ) );
	const showFilter = availableTerms.length >= MIN_TERMS_COUNT_FOR_FILTER;

	return [
		showFilter && (
			<label key="filter-label" htmlFor={ filterInputId }>
				{ filterLabel }
			</label>
		),
		showFilter && (
			<input
				type="search"
				id={ filterInputId }
				value={ filterValue }
				onChange={ setFilter }
				className="editor-post-taxonomies__hierarchical-terms-filter"
				key="term-filter-input"
			/>
		),
		<div
			className="editor-post-taxonomies__hierarchical-terms-list"
			key="term-list"
			tabIndex="0"
			role="group"
			aria-label={ groupLabel }
		>
			{ renderTerms(
				'' !== filterValue ? filteredTermsTree : availableTermsTree
			) }
		</div>,
		! loading && hasCreateAction && (
			<Button
				key="term-add-button"
				onClick={ onToggleForm }
				className="editor-post-taxonomies__hierarchical-terms-add"
				aria-expanded={ showForm }
				variant="link"
			>
				{ newTermButtonLabel }
			</Button>
		),
		showForm && (
			<form onSubmit={ onAddTerm } key="hierarchical-terms-form">
				<label
					htmlFor={ inputId }
					className="editor-post-taxonomies__hierarchical-terms-label"
				>
					{ newTermLabel }
				</label>
				<input
					type="text"
					id={ inputId }
					className="editor-post-taxonomies__hierarchical-terms-input"
					value={ formName }
					onChange={ onChangeFormName }
					required
				/>
				{ !! availableTerms.length && (
					<TreeSelect
						label={ parentSelectLabel }
						noOptionLabel={ noParentOption }
						onChange={ onChangeFormParent }
						selectedId={ formParent }
						tree={ availableTermsTree }
					/>
				) }
				<Button
					variant="secondary"
					type="submit"
					className="editor-post-taxonomies__hierarchical-terms-submit"
				>
					{ newTermSubmitLabel }
				</Button>
			</form>
		),
	];
}

export default compose( [
	withSelect( ( select, { slug } ) => {
		const { getCurrentPost } = select( editorStore );
		const { getTaxonomy } = select( coreStore );
		const taxonomy = getTaxonomy( slug );
		const { getEntityRecords } = select( coreStore );

		const taxonomySlug = slug ?? '';
		const availableTerms =
			getEntityRecords( 'taxonomy', taxonomySlug, {
				per_page: -1,
				context: 'view',
			} ) || [];
		const terms = taxonomy
			? select( editorStore ).getEditedPostAttribute( taxonomy.rest_base )
			: [];
		return {
			hasCreateAction: taxonomy
				? get(
						getCurrentPost(),
						[ '_links', 'wp:action-create-' + taxonomy.rest_base ],
						false
				  )
				: false,
			hasAssignAction: taxonomy
				? get(
						getCurrentPost(),
						[ '_links', 'wp:action-assign-' + taxonomy.rest_base ],
						false
				  )
				: false,
			terms,
			availableTerms,
			availableTermsTree: sortBySelected(
				buildTermsTree( availableTerms ),
				terms
			),
			taxonomy,
		};
	} ),
	withDispatch( ( dispatch ) => ( {
		onUpdateTerms( terms, restBase ) {
			dispatch( editorStore ).editPost( { [ restBase ]: terms } );
		},
		addTerm( term, slug ) {
			return dispatch( coreStore ).saveEntityRecord(
				'taxonomy',
				slug,
				term,
				{ isAutosave: false }
			);
		},
	} ) ),
	withFilters( 'editor.PostTaxonomyType' ),
] )( HierarchicalTermSelector );
