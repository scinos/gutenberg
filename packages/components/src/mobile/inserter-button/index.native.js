/**
 * External dependencies
 */
import { View, TouchableHighlight, Text } from 'react-native';

/**
 * WordPress dependencies
 */
import { Component } from '@wordpress/element';
import { Icon } from '@wordpress/components';
import { withPreferredColorScheme } from '@wordpress/compose';
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import styles from './style.scss';
import Badge from '../badge';

class MenuItem extends Component {
	constructor() {
		super( ...arguments );

		this.onPress = this.onPress.bind( this );
	}

	onPress() {
		const { onSelect, item } = this.props;
		onSelect( item );
	}

	render() {
		const {
			getStylesFromColorScheme,
			item,
			itemWidth,
			maxWidth,
		} = this.props;

		const modalIconWrapperStyle = getStylesFromColorScheme(
			styles.modalIconWrapper,
			styles.modalIconWrapperDark
		);
		const modalIconStyle = getStylesFromColorScheme(
			styles.modalIcon,
			styles.modalIconDark
		);
		const modalItemLabelStyle = getStylesFromColorScheme(
			styles.modalItemLabel,
			styles.modalItemLabelDark
		);

		const clipboardBlockStyles = getStylesFromColorScheme(
			styles.clipboardBlock,
			styles.clipboardBlockDark
		);

		const isClipboardBlock = item.id === 'clipboard';
		const blockTitle = isClipboardBlock ? __( 'Copied block' ) : item.title;

		return (
			<TouchableHighlight
				style={ [
					styles.touchableArea,
					item.isDisabled ? styles.disabled : null,
				] }
				underlayColor="transparent"
				activeOpacity={ 0.5 }
				accessibilityRole="button"
				accessibilityLabel={ `${ item.title } block` }
				onPress={ this.onPress }
				disabled={ item.isDisabled }
			>
				<View style={ [ styles.modalItem, { width: maxWidth } ] }>
					<View
						style={ [
							modalIconWrapperStyle,
							itemWidth && {
								width: itemWidth,
							},
							isClipboardBlock && clipboardBlockStyles,
						] }
					>
						<Badge
							label={ __( 'New' ) }
							position={ { top: 4, left: 4 } }
							show={ item.isNew === true }
							size="small"
						>
							<View style={ modalIconStyle }>
								<Icon
									icon={ item.icon.src || item.icon }
									fill={ modalIconStyle.fill }
									size={ modalIconStyle.width }
								/>
							</View>
						</Badge>
					</View>
					<Text numberOfLines={ 3 } style={ modalItemLabelStyle }>
						{ blockTitle }
					</Text>
				</View>
			</TouchableHighlight>
		);
	}
}

const InserterButton = withPreferredColorScheme( MenuItem );

InserterButton.Styles = {
	modalItem: styles.modalItem,
	modalIconWrapper: styles.modalIconWrapper,
};

export default InserterButton;
