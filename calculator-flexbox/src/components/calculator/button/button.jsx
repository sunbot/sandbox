import React from "react";
import styles from "./button.module.css";

const Button = props => {
  return <div className={styles.button}>{props.content}</div>;
};

export default Button;
