/**
 * External dependencies
 */
import { isEmpty } from 'lodash';

/**
 * Internal dependencies
 */
import { isValueNumeric } from './values';

let __styleTestNode: null | HTMLDivElement = null;

const getComputedStyledMap = (): CSSStyleDeclaration => {
	// For SSR
	if ( typeof window === 'undefined' ) return {} as CSSStyleDeclaration;

	if ( ! __styleTestNode ) {
		__styleTestNode = document.createElement( 'div' );
	}

	return __styleTestNode.style;
};

/**
 * Gets the value to be applied to the CSS Object Model.
 *
 * @param  initialValue
 *
 * @return The parsed CSS value.
 */
export const getParsedCSSValue = (
	initialValue: string
): number | string | undefined => {
	const [ value, unit ] = parseUnitValue( initialValue );
	const next = ! unit ? value : `${ value }${ unit }`;

	return next;
};

/**
 * Checks if a value is valid given a CSS prop.
 *
 * @param  prop
 * @param  value
 *
 * @return Whether the value is a valid CSS value.
 */
export const isValidCSSValueForProp = (
	prop: keyof CSSStyleDeclaration,
	value: string
): boolean => {
	// For SSR
	if ( typeof window === 'undefined' ) return true;
	if ( typeof prop !== 'string' ) return true;

	const computedStyleMap = getComputedStyledMap();

	if ( typeof computedStyleMap[ prop ] === 'undefined' ) return true;

	// 1. Reset current style value.
	// @ts-ignore
	computedStyleMap[ prop ] = '';
	// 2. Cache current style value for validation (may not be an empty string).
	const current = computedStyleMap[ prop ];
	// 3. Apply next value.
	const next = getParsedCSSValue( value );
	// @ts-ignore
	computedStyleMap[ prop ] = next;
	// 4. Check to see if next value was correctly applied.
	return current !== computedStyleMap[ prop ];
};

/**
 * Checks a value to see if it is a valid numeric unit value.
 *
 * Examples of valid numeric unit values include:
 * 0px, 1em, 0, -1, 12.5px
 *
 * @param  value
 *
 * @return  Whether the value is a valid numeric unit value.
 */
export const isValidNumericUnitValue = ( value: string ): boolean => {
	// Disallow values that contains spaces
	if ( / /g.test( value ) ) {
		return false;
	}

	// Disallow values that start with 0 that isn't a decimal.
	if ( /^0[0-9]/g.test( value ) ) {
		return false;
	}

	// Disallow values where the last character is a symbol
	if ( /[-!$^&*()_+|~=`{}[\]:";'<>?,./]$/g.test( value ) ) {
		return false;
	}

	// Allow numerics.
	if ( isValueNumeric( value ) ) return true;

	// Disallow values that do not start with alphanumeric characters.
	if ( /^\W/g.test( value ) ) {
		// Allow for negative numbers, e.g. -1
		if ( ! /^-\w/g.test( value ) ) {
			return false;
		}
	}

	// Disallow values where a dot follows a character, e.g. 1.p
	if ( /\.[a-zA-Z]/g.test( value ) ) {
		return false;
	}

	// Disable values where there are multiple . chracters.
	if ( /\d+\.\d+\.\d+/g.test( value ) ) {
		return false;
	}

	return true;
};

/**
 * Handles legacy value + unit handling.
 * This component use to manage both incoming value and units separately.
 *
 * Moving forward, ideally the value should be a string that contains both
 * the value and unit, example: '10px'
 *
 * @param  value Value
 * @param  unit  Unit value
 *
 * @return  The extracted number and unit.
 */
export function getParsedValue(
	value: number | string,
	unit: string
): ReturnType< typeof parseUnitValue > {
	const initialValue = unit ? `${ value }${ unit }` : value;

	return parseUnitValue( initialValue );
}

/**
 * Checks if units are defined.
 *
 * @param  units Units to check.
 *
 * @return Whether units are defined.
 */
export function hasUnits( units: any ): boolean {
	return ! isEmpty( units ) && units.length > 1 && units !== false;
}

/**
 * Parses a number and unit from a value.
 *
 * @param  initialValue Value to parse
 *
 * @return  The extracted number and unit.
 */
export function parseUnitValue(
	initialValue: string | number
): [ number | string | undefined, string | undefined ] {
	// eslint-disable-next-line eqeqeq
	if ( initialValue == null ) {
		return [ undefined, undefined ];
	}

	const value = String( initialValue ).trim();

	let num: number | string = parseFloat( value );
	num = Number.isNaN( num ) ? '' : num;

	const matched = value.match( /[\d.\-+]*\s*(.*)/ );
	if ( ! matched ) {
		return [ undefined, undefined ];
	}
	const [ , unitMatch ] = matched;

	// eslint-disable-next-line eqeqeq
	let unit = unitMatch != null ? unitMatch : '';
	unit = unit.toLowerCase();

	return [ num, unit ];
}

/**
 * Combines a value and a unit into a unit value.
 *
 * @param  value
 * @param  [unit]
 *
 * @return The unit value.
 */
export function createUnitValue(
	value: string | number,
	unit: string
): string {
	if ( ! unit || typeof unit !== 'string' || ! isValueNumeric( value ) ) {
		return value.toString();
	}

	return `${ value }${ unit }`;
}
